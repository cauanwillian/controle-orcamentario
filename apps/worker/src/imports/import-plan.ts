import dotenv from "dotenv";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

type AccountRow = {
  code: string;
  name: string;
  group: string | null;
  subgroup: string | null;
  sectorCode: string | null;
  sector: string | null;
  accessScope: string | null;
  objective: "MAIOR" | "MENOR";
};

function text(value: ExcelJS.CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "text" in value) return String(value.text).trim() || null;
  return String(value).trim() || null;
}

async function checksum(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

async function loadAccounts(filePath: string): Promise<AccountRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("DRE");
  if (!sheet) throw new Error("A aba DRE não foi encontrada no arquivo do Plano de Contas.");

  const accounts = new Map<string, AccountRow>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = text(row.getCell(1).value);
    const group = text(row.getCell(2).value);
    const name = text(row.getCell(7).value);
    if (!code) return;
    if (!name) throw new Error(`Linha ${rowNumber}: conta com código, mas sem descrição.`);

    accounts.set(code, {
      code,
      group,
      name,
      subgroup: text(row.getCell(3).value),
      sectorCode: text(row.getCell(4).value),
      sector: text(row.getCell(5).value),
      accessScope: text(row.getCell(6).value),
      objective: code.startsWith("7") ? "MAIOR" : "MENOR"
    });
  });
  return [...accounts.values()];
}

async function run() {
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) throw new Error("Informe o caminho do arquivo: pnpm import:plan -- \"C:\\caminho\\PLANO DE CONTA.xlsx\"");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");

  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) throw new Error("O caminho informado não é um arquivo.");
  const [accounts, fileChecksum] = await Promise.all([loadAccounts(filePath), checksum(filePath)]);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ id: string }>(
      "INSERT INTO import_batch (source_type, original_filename, checksum_sha256, status) VALUES ('PLANO_CONTAS', $1, $2, 'PROCESSANDO') RETURNING id",
      [filePath.split(/[\\/]/).pop(), fileChecksum]
    );
    const batchId = batch.rows[0].id;

    for (const account of accounts) {
      await client.query(
        `INSERT INTO account (account_code, account_name, group_name, subgroup_name, sector_code, sector_name, access_scope_name, objective, source_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (account_code) DO UPDATE SET
           account_name = EXCLUDED.account_name,
           group_name = EXCLUDED.group_name,
           subgroup_name = EXCLUDED.subgroup_name,
           sector_code = EXCLUDED.sector_code,
           sector_name = EXCLUDED.sector_name,
           access_scope_name = EXCLUDED.access_scope_name,
           objective = EXCLUDED.objective,
           source_batch_id = EXCLUDED.source_batch_id,
           updated_at = NOW()`,
        [account.code, account.name, account.group, account.subgroup, account.sectorCode, account.sector, account.accessScope, account.objective, batchId]
      );
    }

    await client.query("UPDATE import_batch SET status = 'PUBLICADO', record_count = $1, completed_at = NOW() WHERE id = $2", [accounts.length, batchId]);
    await client.query("COMMIT");
    console.log(`Plano de Contas importado: ${accounts.length} contas.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
