import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

type LedgerRow = {
  sourceKey: string;
  rowNumber: number;
  postingDate: string;
  accountCode: string;
  accountName: string | null;
  paCode: string;
  lotCode: string;
  entryNumber: string;
  groupingCode: string | null;
  history: string | null;
  debitAmount: number;
  creditAmount: number;
  balanceAmount: number | null;
  balanceNature: string | null;
};

function text(value: ExcelJS.CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value && typeof value === "object" && "result" in value) {
    const result = value.result;
    return result === null ? null : String(result).trim() || null;
  }
  if (value && typeof value === "object" && "text" in value) return String(value.text).trim() || null;
  return String(value).trim() || null;
}

function number(value: ExcelJS.CellValue | undefined, rowNumber: number, label: string, nullable = false): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value && typeof value.result === "number") return value.result;
  if (value === null || value === undefined || value === "" || String(value).trim() === "-") return nullable ? null : 0;
  const raw = String(value).trim();
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  if (!Number.isFinite(parsed)) throw new Error(`Linha ${rowNumber}: ${label} não possui valor numérico.`);
  return parsed;
}

function postingDate(value: ExcelJS.CellValue | undefined, rowNumber: number): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Linha ${rowNumber}: DATA inválida.`);
  return parsed.toISOString().slice(0, 10);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function checksum(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hasher = createHash("sha256");
    createReadStream(filePath).on("data", (chunk) => hasher.update(chunk)).on("end", () => resolve(hasher.digest("hex"))).on("error", reject);
  });
}

async function readLedger(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("CTBLivroRazaoAnalitico");
  if (!sheet) throw new Error("A aba CTBLivroRazaoAnalitico não foi encontrada.");
  if (text(sheet.getRow(7).getCell(1).value)?.toUpperCase() !== "DATA") throw new Error("Cabeçalho DATA não encontrado na linha 7.");

  let accountCode: string | null = null;
  let accountName: string | null = null;
  let skippedRows = 0;
  const rows: LedgerRow[] = [];
  const sourceKeys = new Set<string>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 7) return;
    const firstValue = row.getCell(1).value;
    if (firstValue === "CONTA:") {
      accountCode = text(row.getCell(2).value);
      accountName = text(row.getCell(3).value);
      if (!accountCode) throw new Error(`Linha ${rowNumber}: cabeçalho de conta sem código.`);
      return;
    }
    if (!(firstValue instanceof Date)) {
      skippedRows += 1;
      return;
    }
    if (!accountCode) throw new Error(`Linha ${rowNumber}: lançamento sem conta contábil anterior.`);
    const date = postingDate(firstValue, rowNumber);
    const lotCode = text(row.getCell(2).value);
    const entryNumber = text(row.getCell(3).value);
    const paCode = text(row.getCell(4).value);
    if (!lotCode || !entryNumber || !paCode) throw new Error(`Linha ${rowNumber}: lote, lançamento ou PA não informado.`);
    const groupingCode = text(row.getCell(5).value);
    const sourceKey = hash([date, accountCode, paCode, lotCode, entryNumber, groupingCode ?? ""].join("|"));
    if (sourceKeys.has(sourceKey)) throw new Error(`Linha ${rowNumber}: lançamento duplicado no próprio arquivo.`);
    sourceKeys.add(sourceKey);
    rows.push({
      sourceKey,
      rowNumber,
      postingDate: date,
      accountCode,
      accountName,
      paCode,
      lotCode,
      entryNumber,
      groupingCode,
      history: text(row.getCell(6).value),
      debitAmount: number(row.getCell(7).value, rowNumber, "VALOR A DÉBITO") ?? 0,
      creditAmount: number(row.getCell(8).value, rowNumber, "VALOR A CRÉDITO") ?? 0,
      balanceAmount: number(row.getCell(9).value, rowNumber, "SALDO", true),
      balanceNature: text(row.getCell(11).value)
    });
  });
  if (rows.length === 0) throw new Error("Nenhum lançamento contábil foi identificado no arquivo.");
  return { rows, skippedRows };
}

async function run() {
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) throw new Error("Informe o caminho do arquivo: pnpm import:ledger -- \"C:\\caminho\\LIVRO_RAZAO.xlsx\"");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");
  if (!(await stat(filePath)).isFile()) throw new Error("O caminho informado não é um arquivo.");
  const [{ rows, skippedRows }, fileChecksum] = await Promise.all([readLedger(filePath), checksum(filePath)]);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ id: string }>(
      "INSERT INTO import_batch (source_type, original_filename, checksum_sha256, status, reference_date) VALUES ('LIVRO_RAZAO', $1, $2, 'PROCESSANDO', $3) RETURNING id",
      [filePath.split(/[\\/]/).pop(), fileChecksum, rows.reduce((latest, row) => row.postingDate > latest ? row.postingDate : latest, rows[0].postingDate)]
    );
    const batchId = batch.rows[0].id;
    const accounts = await client.query<{ id: string; account_code: string }>("SELECT id, account_code FROM account");
    const accountIds = new Map(accounts.rows.map((account) => [account.account_code, account.id]));
    const batchSize = 400;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const group = rows.slice(offset, offset + batchSize);
      const values: unknown[] = [];
      const placeholders = group.map((row, index) => {
        const base = index * 16;
        values.push(row.sourceKey, row.postingDate, row.accountCode, row.accountName, accountIds.get(row.accountCode) ?? null, row.paCode, row.lotCode, row.entryNumber, row.groupingCode, row.history, row.debitAmount, row.creditAmount, row.balanceAmount, row.balanceNature, batchId, row.rowNumber);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16})`;
      });
      await client.query(
        `INSERT INTO ledger_entry (source_key, posting_date, account_code, account_name, account_id, pa_code, lot_code, entry_number, grouping_code, history, debit_amount, credit_amount, balance_amount, balance_nature, source_batch_id, source_row_number) VALUES ${placeholders.join(", ")}
         ON CONFLICT (source_key) DO UPDATE SET account_name = EXCLUDED.account_name, account_id = EXCLUDED.account_id, grouping_code = EXCLUDED.grouping_code, history = EXCLUDED.history, debit_amount = EXCLUDED.debit_amount, credit_amount = EXCLUDED.credit_amount, balance_amount = EXCLUDED.balance_amount, balance_nature = EXCLUDED.balance_nature, source_batch_id = EXCLUDED.source_batch_id, source_row_number = EXCLUDED.source_row_number, updated_at = NOW()`,
        values
      );
    }
    await client.query("UPDATE import_batch SET status = 'PUBLICADO', record_count = $1, completed_at = NOW() WHERE id = $2", [rows.length, batchId]);
    await client.query("COMMIT");
    const unmappedAccounts = new Set(rows.filter((row) => !accountIds.has(row.accountCode)).map((row) => row.accountCode));
    const latestDate = rows.reduce((latest, row) => row.postingDate > latest ? row.postingDate : latest, rows[0].postingDate);
    console.log(`Livro Razão importado: ${rows.length} lançamentos, data mais recente ${latestDate}, ${unmappedAccounts.size} contas sem mapeamento e ${skippedRows} linhas estruturais ignoradas.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
