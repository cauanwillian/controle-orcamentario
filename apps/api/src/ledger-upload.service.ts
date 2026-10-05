import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { AuthService } from "./auth.service.js";

type LedgerRow = { sourceKey: string; rowNumber: number; postingDate: string; accountCode: string; accountName: string | null; paCode: string; lotCode: string; entryNumber: string; groupingCode: string | null; history: string | null; debitAmount: number; creditAmount: number; balanceAmount: number | null; balanceNature: string | null };
const cellText = (value: ExcelJS.CellValue | undefined) => value === null || value === undefined ? null : String(typeof value === "object" && value && "result" in value ? value.result : value).trim() || null;
const numeric = (value: ExcelJS.CellValue | undefined) => { if (typeof value === "number") return value; const raw = cellText(value); if (!raw || raw === "-") return 0; const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw); if (!Number.isFinite(parsed)) throw new BadRequestException("O arquivo contém valores numéricos inválidos."); return parsed; };

@Injectable()
export class LedgerUploadService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  constructor(private readonly authService: AuthService) {}

  private async permitted(authorization?: string) {
    const viewer = await this.authService.viewer(authorization);
    if (!viewer.fullAccess && !viewer.roles.some((role) => role.toUpperCase().includes("CONTABILIDADE"))) throw new ForbiddenException("Somente Contabilidade pode enviar o Livro Razão.");
    const employee = await this.pool.query<{ id: string }>("SELECT id FROM employee WHERE employee_code = $1", [viewer.employeeCode]);
    if (!employee.rows[0]) throw new ForbiddenException("Colaborador não encontrado.");
    return { viewer, employeeId: employee.rows[0].id };
  }

  private async parse(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("CTBLivroRazaoAnalitico");
    if (!sheet || cellText(sheet.getRow(7).getCell(1).value)?.toUpperCase() !== "DATA") throw new BadRequestException("Envie o Livro Razão com a aba CTBLivroRazaoAnalitico e cabeçalho DATA na linha 7.");
    let accountCode: string | null = null, accountName: string | null = null; const rows: LedgerRow[] = []; const keys = new Set<string>();
    sheet.eachRow((row, rowNumber) => { if (rowNumber <= 7) return; const first = row.getCell(1).value; if (first === "CONTA:") { accountCode = cellText(row.getCell(2).value); accountName = cellText(row.getCell(3).value); return; } if (!(first instanceof Date)) return; if (!accountCode) throw new BadRequestException(`Lançamento sem conta na linha ${rowNumber}.`); const date = first.toISOString().slice(0, 10), lotCode = cellText(row.getCell(2).value), entryNumber = cellText(row.getCell(3).value), paCode = cellText(row.getCell(4).value); if (!lotCode || !entryNumber || !paCode) throw new BadRequestException(`Lote, lançamento ou PA ausente na linha ${rowNumber}.`); const groupingCode = cellText(row.getCell(5).value), sourceKey = createHash("sha256").update([date, accountCode, paCode, lotCode, entryNumber, groupingCode ?? ""].join("|")).digest("hex"); if (keys.has(sourceKey)) throw new BadRequestException(`Lançamento duplicado na linha ${rowNumber}.`); keys.add(sourceKey); rows.push({ sourceKey, rowNumber, postingDate: date, accountCode, accountName, paCode, lotCode, entryNumber, groupingCode, history: cellText(row.getCell(6).value), debitAmount: numeric(row.getCell(7).value), creditAmount: numeric(row.getCell(8).value), balanceAmount: cellText(row.getCell(9).value) ? numeric(row.getCell(9).value) : null, balanceNature: cellText(row.getCell(11).value) }); });
    if (!rows.length) throw new BadRequestException("Nenhum lançamento foi identificado no arquivo."); return rows;
  }

  async upload(authorization: string | undefined, filename: string, buffer: Buffer) {
    const { employeeId } = await this.permitted(authorization);
    if (!filename.toLowerCase().endsWith(".xlsx")) throw new BadRequestException("Envie um arquivo Excel .xlsx.");
    const rows = await this.parse(buffer), checksum = createHash("sha256").update(buffer).digest("hex"), referenceDate = rows.reduce((latest, row) => row.postingDate > latest ? row.postingDate : latest, rows[0].postingDate);
    const folder = path.resolve(process.cwd(), "data", "uploads"); await mkdir(folder, { recursive: true }); const storedFilename = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}.xlsx`; await writeFile(path.join(folder, storedFilename), buffer);
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const batch = await client.query<{ id: string }>("INSERT INTO import_batch (source_type, original_filename, checksum_sha256, status, reference_date) VALUES ('LIVRO_RAZAO', $1, $2, 'PROCESSANDO', $3) RETURNING id", [filename, checksum, referenceDate]); const batchId = batch.rows[0].id; const accounts = await client.query<{ id: string; account_code: string }>("SELECT id, account_code FROM account"); const ids = new Map(accounts.rows.map((a) => [a.account_code, a.id])); for (const row of rows) await client.query("INSERT INTO ledger_entry (source_key, posting_date, account_code, account_name, account_id, pa_code, lot_code, entry_number, grouping_code, history, debit_amount, credit_amount, balance_amount, balance_nature, source_batch_id, source_row_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (source_key) DO UPDATE SET account_name=EXCLUDED.account_name, account_id=EXCLUDED.account_id, history=EXCLUDED.history, debit_amount=EXCLUDED.debit_amount, credit_amount=EXCLUDED.credit_amount, balance_amount=EXCLUDED.balance_amount, balance_nature=EXCLUDED.balance_nature, source_batch_id=EXCLUDED.source_batch_id, source_row_number=EXCLUDED.source_row_number, updated_at=NOW()", [row.sourceKey,row.postingDate,row.accountCode,row.accountName,ids.get(row.accountCode) ?? null,row.paCode,row.lotCode,row.entryNumber,row.groupingCode,row.history,row.debitAmount,row.creditAmount,row.balanceAmount,row.balanceNature,batchId,row.rowNumber]); await client.query("UPDATE import_batch SET status='PUBLICADO', record_count=$1, completed_at=NOW() WHERE id=$2", [rows.length,batchId]); await client.query("INSERT INTO ledger_upload (import_batch_id, uploaded_by_employee_id, stored_filename) VALUES ($1,$2,$3)", [batchId,employeeId,storedFilename]); await client.query("COMMIT"); return { recordCount: rows.length, referenceDate, uploadedAt: new Date().toISOString() }; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async history(authorization: string | undefined) {
    await this.permitted(authorization);
    const result = await this.pool.query<{ id: string; original_filename: string; record_count: number; reference_date: string; uploaded_at: string; employee_name: string }>(
      `SELECT u.id, b.original_filename, b.record_count, b.reference_date::text, u.uploaded_at, e.name AS employee_name
       FROM ledger_upload u
       JOIN import_batch b ON b.id = u.import_batch_id
       JOIN employee e ON e.id = u.uploaded_by_employee_id
       ORDER BY u.uploaded_at DESC
       LIMIT 20`,
    );
    return result.rows.map((row) => ({ id: row.id, originalFilename: row.original_filename, recordCount: row.record_count, referenceDate: row.reference_date, uploadedAt: row.uploaded_at, employeeName: row.employee_name }));
  }

  async reprocess(authorization: string | undefined, uploadId: string) {
    await this.permitted(authorization);
    const result = await this.pool.query<{ original_filename: string; stored_filename: string }>(
      `SELECT b.original_filename, u.stored_filename
       FROM ledger_upload u JOIN import_batch b ON b.id = u.import_batch_id
       WHERE u.id = $1`,
      [uploadId],
    );
    const upload = result.rows[0];
    if (!upload) throw new NotFoundException("Importação não encontrada.");
    const filename = path.basename(upload.stored_filename);
    let buffer: Buffer;
    try { buffer = await readFile(path.resolve(process.cwd(), "data", "uploads", filename)); }
    catch { throw new NotFoundException("O arquivo original desta importação não está mais disponível."); }
    return this.upload(authorization, upload.original_filename, buffer);
  }
  async onModuleDestroy() { await this.pool.end(); }
}
