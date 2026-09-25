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

const monthNames = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const accountCodePattern = /^\d+(?:\.\d+)+/;

type BudgetRow = { accountCode: string; accountName: string | null; paCode: string; values: number[]; accumulated: number; rowNumber: number };

function text(value: ExcelJS.CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value && typeof value === "object" && "result" in value) {
    const result = value.result;
    return result === null ? null : String(result).trim() || null;
  }
  if (value && typeof value === "object" && "text" in value) return String(value.text).trim() || null;
  return String(value).trim() || null;
}

function number(value: ExcelJS.CellValue | undefined, rowNumber: number, label: string) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value && typeof value.result === "number") return value.result;
  // A planilha usa "-" para representar saldo zero em alguns acumulados.
  if (value === null || value === undefined || value === "" || String(value).trim() === "-") return 0;
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Linha ${rowNumber}: ${label} não possui valor numérico.`);
  return parsed;
}

async function checksum(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

async function readBudget(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("orçamento");
  if (!sheet) throw new Error("A aba orçamento não foi encontrada.");

  for (let index = 0; index < monthNames.length; index += 1) {
    const header = text(sheet.getRow(1).getCell(index + 4).value)?.toUpperCase();
    if (header !== monthNames[index]) throw new Error(`Coluna mensal inesperada na posição ${index + 4}.`);
  }

  const rows: BudgetRow[] = [];
  let skippedRows = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const accountCode = text(row.getCell(1).value);
    if (!accountCode || !accountCodePattern.test(accountCode)) {
      skippedRows += 1;
      return;
    }
    const paCode = text(row.getCell(3).value);
    if (!paCode) throw new Error(`Linha ${rowNumber}: PA não informado.`);
    const accountName = text(row.getCell(2).value);
    const values = monthNames.map((month, index) => number(row.getCell(index + 4).value, rowNumber, month));
    const accumulated = number(row.getCell(16).value, rowNumber, "ACUMULADO");
    if (Math.abs(values.reduce((total, value) => total + value, 0) - accumulated) > 0.02) throw new Error(`Linha ${rowNumber}: acumulado não confere com os meses.`);
    rows.push({ accountCode, accountName, paCode, values, accumulated, rowNumber });
  });
  return { rows, skippedRows };
}

async function run() {
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) throw new Error("Informe o caminho do arquivo: pnpm import:budget -- \"C:\\caminho\\ORÇAMENTO 2026 1.xlsx\"");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");
  if (!(await stat(filePath)).isFile()) throw new Error("O caminho informado não é um arquivo.");
  const yearMatch = filePath.match(/20\d{2}/);
  if (!yearMatch) throw new Error("Não foi possível identificar o ano no nome do arquivo.");
  const fiscalYear = Number(yearMatch[0]);
  const [{ rows, skippedRows }, fileChecksum] = await Promise.all([readBudget(filePath), checksum(filePath)]);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ id: string }>(
      "INSERT INTO import_batch (source_type, original_filename, checksum_sha256, status) VALUES ('ORCAMENTO', $1, $2, 'PROCESSANDO') RETURNING id",
      [filePath.split(/[\\/]/).pop(), fileChecksum]
    );
    const batchId = batch.rows[0].id;
    const version = await client.query<{ id: string }>(
      "INSERT INTO budget_version (fiscal_year, name, source_batch_id) VALUES ($1, $2, $3) ON CONFLICT (fiscal_year) DO UPDATE SET name = EXCLUDED.name, source_batch_id = EXCLUDED.source_batch_id, updated_at = NOW() RETURNING id",
      [fiscalYear, `Orçamento ${fiscalYear}`, batchId]
    );
    const versionId = version.rows[0].id;
    const accountResult = await client.query<{ id: string; account_code: string }>("SELECT id, account_code FROM account");
    const accountIds = new Map(accountResult.rows.map((account) => [account.account_code, account.id]));
    await client.query("DELETE FROM budget_entry WHERE budget_version_id = $1", [versionId]);

    const entries = rows.flatMap((row) => row.values.map((amount, monthIndex) => ({
      periodDate: `${fiscalYear}-${String(monthIndex + 1).padStart(2, "0")}-01`,
      paCode: row.paCode,
      accountCode: row.accountCode,
      accountId: accountIds.get(row.accountCode) ?? null,
      accountName: row.accountName,
      sourceRowNumber: row.rowNumber,
      amount
    })));
    const batchSize = 500;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const group = entries.slice(offset, offset + batchSize);
      const values: unknown[] = [];
      const placeholders = group.map((entry, index) => {
        const base = index * 9;
        values.push(versionId, entry.periodDate, entry.paCode, entry.accountCode, entry.accountId, entry.accountName, entry.sourceRowNumber, entry.amount, batchId);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      });
      await client.query(`INSERT INTO budget_entry (budget_version_id, period_date, pa_code, account_code, account_id, source_account_name, source_row_number, amount, source_batch_id) VALUES ${placeholders.join(", ")}`, values);
    }
    await client.query("UPDATE import_batch SET status = 'PUBLICADO', record_count = $1, completed_at = NOW() WHERE id = $2", [entries.length, batchId]);
    await client.query("COMMIT");
    const unmappedAccounts = new Set(rows.filter((row) => !accountIds.has(row.accountCode)).map((row) => row.accountCode));
    console.log(`Orçamento ${fiscalYear} importado: ${entries.length} valores mensais, ${unmappedAccounts.size} contas sem mapeamento e ${skippedRows} linhas não contábeis ignoradas.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
