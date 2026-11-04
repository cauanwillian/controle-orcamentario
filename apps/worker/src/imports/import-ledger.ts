import dotenv from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { Pool, type PoolClient } from "pg";
import ledgerImport from "@orcamento/shared/ledger-import";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../../");

export function loadLedgerEnvironment() {
  const productionEnvironment = path.join(projectRoot, ".env.production");
  const localEnvironment = path.join(projectRoot, ".env");
  if (existsSync(productionEnvironment)) dotenv.config({ path: productionEnvironment });
  if (existsSync(localEnvironment)) dotenv.config({ path: localEnvironment });
}

export type LedgerUploadSource = "AUTOMATICO" | "CLI";
export class LedgerImportValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "LedgerImportValidationError"; }
}
export type LedgerImportResult = {
  skippedDuplicate?: true;
  existingBatchId?: string;
  checksum: string;
  batchId?: string;
  recordCount?: number;
  referenceDate?: string;
  unmappedAccountCount?: number;
  unmappedAccounts?: string[];
  skippedRows?: number;
  storedFilename?: string;
};

export async function checksumFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hasher = createHash("sha256");
    createReadStream(filePath).on("data", (chunk) => hasher.update(chunk)).on("end", () => resolve(hasher.digest("hex"))).on("error", reject);
  });
}

export function ledgerStorageDirectory() {
  return process.env.LEDGER_STORAGE_DIR
    ? path.resolve(projectRoot, process.env.LEDGER_STORAGE_DIR)
    : path.join(projectRoot, "data", "uploads");
}

export async function findPublishedLedgerBatch(client: Pool | PoolClient, checksum: string) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM import_batch WHERE source_type='LIVRO_RAZAO' AND checksum_sha256=$1 AND status='PUBLICADO' ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1",
    [checksum],
  );
  return result.rows[0]?.id ?? null;
}

export async function recordRejectedBatch(pool: Pool, filename: string, checksum: string, reason: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,error_summary,completed_at) VALUES('LIVRO_RAZAO',$1,$2,'REJEITADO',$3,NOW())", [filename, checksum, reason.slice(0, 4000)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida ao importar o Livro Razão.";
}

export async function importLedgerFile(filePath: string, source: LedgerUploadSource = "CLI", expectedChecksum?: string, originalFilename?: string): Promise<LedgerImportResult> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no ambiente.");
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("O caminho informado não é um arquivo.");
  const checksum = expectedChecksum ?? await checksumFile(filePath);
  const filename = originalFilename ?? path.basename(filePath);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let client: PoolClient | undefined;
  let storedPath: string | undefined;
  let rejectedScope: string | undefined;
  try {
    if (source === "AUTOMATICO") {
      const existingBatchId = await findPublishedLedgerBatch(pool, checksum);
      if (existingBatchId) return { skippedDuplicate: true, existingBatchId, checksum };
    }

    let parsed: ReturnType<typeof ledgerImport.parseLedgerWorkbook>;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      parsed = ledgerImport.parseLedgerWorkbook(workbook);
    } catch (error) {
      const reason = errorMessage(error);
      try { await recordRejectedBatch(pool, filename, checksum, reason); }
      catch (recordError) { throw new Error(`O arquivo falhou na validação, mas o lote REJEITADO não pôde ser salvo: ${reason}`, { cause: recordError }); }
      throw new LedgerImportValidationError(reason, { cause: error });
    }
    const { rows, skippedRows, scope } = parsed;
    const schema = await pool.query<{ ready: boolean }>("SELECT to_regclass('ledger_entry_current') IS NOT NULL AND to_regclass('ledger_import_scope') IS NOT NULL AND EXISTS(SELECT 1 FROM schema_migration WHERE version='011_ledger_snapshot_scopes.sql') AND EXISTS(SELECT 1 FROM schema_migration WHERE version='012_automated_ledger_imports.sql') AS ready");
    if (!schema.rows[0].ready) throw new Error("Atualize o banco com pnpm db:migrate antes de importar o Livro Razão.");

    const storage = ledgerStorageDirectory();
    await mkdir(storage, { recursive: true });
    const storedFilename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}.xlsx`;
    storedPath = path.join(storage, storedFilename);
    await copyFile(filePath, storedPath);

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ledger-import-current'))");
    if (source === "AUTOMATICO") {
      const existingBatchId = await findPublishedLedgerBatch(client, checksum);
      if (existingBatchId) {
        await client.query("ROLLBACK");
        await rm(storedPath, { force: true });
        return { skippedDuplicate: true, existingBatchId, checksum };
      }
    }
    const referenceDate = rows.reduce((latest, row) => row.postingDate > latest ? row.postingDate : latest, rows[0].postingDate);
    const batch = await client.query<{ id: string }>(
      "INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,reference_date) VALUES('LIVRO_RAZAO',$1,$2,'PROCESSANDO',$3) RETURNING id",
      [filename, checksum, referenceDate],
    );
    const batchId = batch.rows[0].id;
    const accounts = await client.query<{ id: string; account_code: string }>("SELECT id,account_code FROM account");
    const accountIds = new Map(accounts.rows.map((account) => [account.account_code, account.id]));
    const unmappedAccounts = [...new Set(rows.map((row) => row.accountCode).filter((code) => !accountIds.has(code)))].sort();
    await ledgerImport.insertLedgerEntries(client, rows, accountIds, batchId, 400);
    try { await ledgerImport.registerLedgerSnapshotScope(client, batchId, scope); }
    catch (error) { rejectedScope = errorMessage(error); throw new LedgerImportValidationError(rejectedScope, { cause: error }); }
    await client.query("UPDATE import_batch SET status='PUBLICADO',record_count=$1,completed_at=NOW() WHERE id=$2", [rows.length, batchId]);
    await client.query("INSERT INTO ledger_upload(import_batch_id,uploaded_by_employee_id,stored_filename,upload_source,unmapped_account_count) VALUES($1,NULL,$2,$3,$4)",
      [batchId, storedFilename, source, unmappedAccounts.length]);
    await client.query("COMMIT");
    return { batchId, checksum, recordCount: rows.length, referenceDate, unmappedAccountCount: unmappedAccounts.length, unmappedAccounts, skippedRows, storedFilename };
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    if (storedPath) await rm(storedPath, { force: true }).catch(() => undefined);
    if (rejectedScope) {
      try { await recordRejectedBatch(pool, filename, checksum, rejectedScope); }
      catch (recordError) { throw new Error(`O escopo falhou na validação, mas o lote REJEITADO não pôde ser salvo: ${rejectedScope}`, { cause: recordError }); }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function run() {
  loadLedgerEnvironment();
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) throw new Error("Informe o caminho do arquivo: pnpm import:ledger -- \"C:\\caminho\\LIVRO_RAZAO.xlsx\"");
  const result = await importLedgerFile(filePath, "CLI");
  console.log(`Livro Razão importado: ${result.recordCount} lançamentos, ${result.unmappedAccountCount} contas sem mapeamento (${result.unmappedAccounts?.join(", ") || "nenhuma"}), ${result.skippedRows} linhas estruturais ignoradas.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => { console.error(error); process.exitCode = 1; });
}
