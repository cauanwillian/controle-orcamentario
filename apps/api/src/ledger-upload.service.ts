import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { Pool, type PoolClient } from "pg";
import ledgerImport from "@orcamento/shared/ledger-import";
import { AuthService } from "./auth.service.js";

function storageDirectory() {
  const projectRoot = path.resolve(__dirname, "../../..");
  return process.env.LEDGER_STORAGE_DIR
    ? path.resolve(projectRoot, process.env.LEDGER_STORAGE_DIR)
    : path.join(projectRoot, "data", "uploads");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida ao importar o Livro Razão.";
}

@Injectable()
export class LedgerUploadService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  constructor(private readonly authService: AuthService) {}

  private async permitted(authorization?: string) {
    const viewer = await this.authService.viewer(authorization);
    if (!viewer.fullAccess && !viewer.roles.some((role) => role.toUpperCase().includes("CONTABILIDADE"))) throw new ForbiddenException("Somente Contabilidade pode enviar o Livro Razão.");
    const employee = await this.pool.query<{ id: string }>("SELECT id FROM employee WHERE employee_code = $1", [viewer.employeeCode]);
    if (!employee.rows[0]) throw new ForbiddenException("Colaborador não encontrado.");
    return { employeeId: employee.rows[0].id };
  }

  private async recordRejectedBatch(filename: string, checksum: string, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,error_summary,completed_at) VALUES('LIVRO_RAZAO',$1,$2,'REJEITADO',$3,NOW())",
        [filename, checksum, reason.slice(0, 4000)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async reject(filename: string, checksum: string, reason: string): Promise<never> {
    try { await this.recordRejectedBatch(filename, checksum, reason); }
    catch (error) {
      console.error("Não foi possível registrar o lote rejeitado do Livro Razão:", error);
      throw new ServiceUnavailableException("O arquivo falhou na validação, mas não foi possível salvar o registro de rejeição. Tente novamente mais tarde.");
    }
    throw new BadRequestException(reason);
  }

  async upload(authorization: string | undefined, filename: string, buffer: Buffer) {
    const { employeeId } = await this.permitted(authorization);
    const checksum = createHash("sha256").update(buffer).digest("hex");
    if (!filename.toLowerCase().endsWith(".xlsx")) return this.reject(filename, checksum, "Envie um arquivo Excel .xlsx.");
    const schema = await this.pool.query<{ ready: boolean }>("SELECT to_regclass('ledger_entry_current') IS NOT NULL AND to_regclass('ledger_import_scope') IS NOT NULL AND EXISTS(SELECT 1 FROM schema_migration WHERE version='011_ledger_snapshot_scopes.sql') AND EXISTS(SELECT 1 FROM schema_migration WHERE version='012_automated_ledger_imports.sql') AS ready");
    if (!schema.rows[0].ready) throw new ServiceUnavailableException("A atualização do banco contábil ainda não foi concluída. Contate o administrador antes de importar novamente.");

    let parsed: ReturnType<typeof ledgerImport.parseLedgerWorkbook>;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      parsed = ledgerImport.parseLedgerWorkbook(workbook);
    } catch (error) {
      return this.reject(filename, checksum, errorMessage(error));
    }
    const { rows, scope } = parsed;
    const referenceDate = rows.reduce((latest, row) => row.postingDate > latest ? row.postingDate : latest, rows[0].postingDate);
    const folder = storageDirectory();
    await mkdir(folder, { recursive: true });
    const storedFilename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}.xlsx`;
    const storedPath = path.join(folder, storedFilename);
    await writeFile(storedPath, buffer, { flag: "wx" });
    let client: PoolClient | undefined;
    let rejectedScope: string | null = null;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ledger-import-current'))");
      const batch = await client.query<{ id: string }>(
        "INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,reference_date) VALUES('LIVRO_RAZAO',$1,$2,'PROCESSANDO',$3) RETURNING id",
        [filename, checksum, referenceDate],
      );
      const batchId = batch.rows[0].id;
      const accounts = await client.query<{ id: string; account_code: string }>("SELECT id, account_code FROM account");
      const accountIds = new Map(accounts.rows.map((account) => [account.account_code, account.id]));
      const unmapped = [...new Set(rows.map((row) => row.accountCode).filter((accountCode) => !accountIds.has(accountCode)))].sort();
      await ledgerImport.insertLedgerEntries(client, rows, accountIds, batchId, 400);
      try { await ledgerImport.registerLedgerSnapshotScope(client, batchId, scope); }
      catch (error) { rejectedScope = errorMessage(error); throw new BadRequestException(rejectedScope); }
      await client.query("UPDATE import_batch SET status='PUBLICADO',record_count=$1,completed_at=NOW() WHERE id=$2", [rows.length, batchId]);
      await client.query("INSERT INTO ledger_upload(import_batch_id,uploaded_by_employee_id,stored_filename,upload_source,unmapped_account_count) VALUES($1,$2,$3,$4,$5)",
        [batchId, employeeId, storedFilename, "MANUAL", unmapped.length]);
      await client.query("COMMIT");
      return { recordCount: rows.length, referenceDate, uploadedAt: new Date().toISOString(), unmappedAccountCount: unmapped.length, unmappedAccounts: unmapped };
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => undefined);
      await rm(storedPath, { force: true }).catch(() => undefined);
      if (rejectedScope) {
        try { await this.recordRejectedBatch(filename, checksum, rejectedScope); }
        catch (recordError) {
          console.error("Não foi possível registrar o lote rejeitado do Livro Razão:", recordError);
          throw new ServiceUnavailableException("O escopo falhou na validação, mas não foi possível salvar o registro de rejeição. Tente novamente mais tarde.");
        }
      }
      throw error;
    } finally {
      client?.release();
    }
  }

  async history(authorization: string | undefined) {
    await this.permitted(authorization);
    const result = await this.pool.query<{ id: string; original_filename: string; record_count: number; reference_date: string; uploaded_at: string; employee_name: string }>(
      `SELECT u.id, b.original_filename, b.record_count, b.reference_date::text, u.uploaded_at,
              COALESCE(e.name, CASE WHEN u.upload_source='AUTOMATICO' THEN 'Rotina Automática' WHEN u.upload_source='CLI' THEN 'Importação CLI' ELSE 'Sistema' END) AS employee_name
       FROM ledger_upload u JOIN import_batch b ON b.id=u.import_batch_id
       LEFT JOIN employee e ON e.id=u.uploaded_by_employee_id
       ORDER BY u.uploaded_at DESC LIMIT 20`,
    );
    return result.rows.map((row) => ({ id: row.id, originalFilename: row.original_filename, recordCount: row.record_count, referenceDate: row.reference_date, uploadedAt: row.uploaded_at, employeeName: row.employee_name }));
  }

  async reprocess(authorization: string | undefined, uploadId: string) {
    await this.permitted(authorization);
    const result = await this.pool.query<{ original_filename: string; stored_filename: string }>(
      "SELECT b.original_filename,u.stored_filename FROM ledger_upload u JOIN import_batch b ON b.id=u.import_batch_id WHERE u.id=$1", [uploadId],
    );
    const upload = result.rows[0];
    if (!upload) throw new NotFoundException("Importação não encontrada.");
    const filename = path.basename(upload.stored_filename);
    const configuredPath = path.join(storageDirectory(), filename);
    let buffer: Buffer;
    try { buffer = await readFile(configuredPath); }
    catch {
      // Keep uploads created before LEDGER_STORAGE_DIR was introduced reprocessable.
      try { buffer = await readFile(path.resolve(process.cwd(), "data", "uploads", filename)); }
      catch { throw new NotFoundException("O arquivo original desta importação não está mais disponível."); }
    }
    return this.upload(authorization, upload.original_filename, buffer);
  }

  async onModuleDestroy() { await this.pool.end(); }
}
