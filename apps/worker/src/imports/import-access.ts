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

type Role = { code: string | null; name: string };
type Employee = { code: string; name: string; active: boolean };
type RoleSector = { role: string; sector: string };
type EmployeeRole = { employeeName: string; role: string };
type Pa = { code: string; agency: string | null; regionalCode: string | null; regionalName: string | null; city: string | null; isOffice: boolean; responsibleName: string | null };

function text(value: ExcelJS.CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "result" in value) return value.result === null ? null : String(value.result).trim() || null;
  if (typeof value === "object" && "text" in value) return String(value.text).trim() || null;
  return String(value).trim() || null;
}

async function checksum(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

function rows(sheet: ExcelJS.Worksheet) {
  return [...Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getRow(index + 2))];
}

async function readAccessFile(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const relationships = workbook.getWorksheet("Relacoes");
  const employeesSheet = workbook.getWorksheet("Lista Empregados");
  const rolesSheet = workbook.getWorksheet("Lista Cargos");
  const paSheet = workbook.getWorksheet("PA_MATRIX");
  if (!relationships || !employeesSheet || !rolesSheet || !paSheet) throw new Error("A planilha de Controle de Acessos não possui todas as abas obrigatórias.");

  const roles: Role[] = rows(rolesSheet).flatMap((row) => {
    const name = text(row.getCell(1).value);
    return name ? [{ code: text(row.getCell(2).value), name }] : [];
  });
  const employees: Employee[] = rows(employeesSheet).flatMap((row) => {
    const code = text(row.getCell(1).value);
    const name = text(row.getCell(2).value);
    return code && name ? [{ code, name, active: true }] : [];
  });
  const roleSectors: RoleSector[] = rows(relationships).flatMap((row) => {
    const role = text(row.getCell(1).value);
    const sector = text(row.getCell(2).value);
    return role && sector ? [{ role, sector }] : [];
  });
  const employeeRoles: EmployeeRole[] = rows(relationships).flatMap((row) => {
    const role = text(row.getCell(4).value);
    const employeeName = text(row.getCell(5).value);
    return role && employeeName ? [{ role, employeeName }] : [];
  });
  const pas: Pa[] = rows(paSheet).flatMap((row) => {
    const code = text(row.getCell(1).value);
    if (!code) return [];
    return [{
      code,
      agency: text(row.getCell(2).value),
      regionalCode: text(row.getCell(3).value),
      regionalName: text(row.getCell(4).value),
      city: text(row.getCell(5).value),
      isOffice: text(row.getCell(6).value) === "1",
      responsibleName: text(row.getCell(7).value)
    }];
  });
  return { roles, employees, roleSectors, employeeRoles, pas };
}

async function run() {
  const filePath = process.argv.slice(2).find((argument) => argument !== "--");
  if (!filePath) throw new Error("Informe o caminho do arquivo: pnpm import:access -- \"C:\\caminho\\CONTROLE DE ACESSOS.xlsx\"");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");
  if (!(await stat(filePath)).isFile()) throw new Error("O caminho informado não é um arquivo.");

  const [data, fileChecksum] = await Promise.all([readAccessFile(filePath), checksum(filePath)]);
  const employeeByName = new Map(data.employees.map((employee) => [employee.name, employee]));
  const roleByName = new Map(data.roles.map((role) => [role.name, role]));
  for (const relation of [...data.roleSectors, ...data.employeeRoles]) {
    if (!roleByName.has(relation.role)) roleByName.set(relation.role, { name: relation.role, code: null });
  }
  for (const relation of data.employeeRoles) {
    if (!employeeByName.has(relation.employeeName)) {
      const pendingEmployee = { code: `PENDENTE:${relation.employeeName}`, name: relation.employeeName, active: false };
      data.employees.push(pendingEmployee);
      employeeByName.set(pendingEmployee.name, pendingEmployee);
    }
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await client.query<{ id: string }>(
      "INSERT INTO import_batch (source_type, original_filename, checksum_sha256, status) VALUES ('CONTROLE_ACESSOS', $1, $2, 'PROCESSANDO') RETURNING id",
      [filePath.split(/[\\/]/).pop(), fileChecksum]
    );
    const batchId = batch.rows[0].id;
    const roleIds = new Map<string, string>();
    const employeeIds = new Map<string, string>();

    for (const role of roleByName.values()) {
      const result = await client.query<{ id: string }>(
        "INSERT INTO job_role (external_code, name, source_batch_id) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET external_code = EXCLUDED.external_code, source_batch_id = EXCLUDED.source_batch_id, updated_at = NOW() RETURNING id",
        [role.code, role.name, batchId]
      );
      roleIds.set(role.name, result.rows[0].id);
    }
    for (const employee of data.employees) {
      const result = await client.query<{ id: string }>(
        "INSERT INTO employee (employee_code, name, active, source_batch_id) VALUES ($1, $2, $3, $4) ON CONFLICT (employee_code) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active, source_batch_id = EXCLUDED.source_batch_id, updated_at = NOW() RETURNING id",
        [employee.code, employee.name, employee.active, batchId]
      );
      employeeIds.set(employee.name, result.rows[0].id);
    }
    await client.query("DELETE FROM role_sector_permission");
    await client.query("DELETE FROM employee_role");
    for (const relation of data.roleSectors) await client.query("INSERT INTO role_sector_permission (role_id, sector_name, source_batch_id) VALUES ($1, $2, $3)", [roleIds.get(relation.role), relation.sector, batchId]);
    for (const relation of data.employeeRoles) await client.query("INSERT INTO employee_role (employee_id, role_id, source_batch_id) VALUES ($1, $2, $3)", [employeeIds.get(relation.employeeName), roleIds.get(relation.role), batchId]);
    for (const pa of data.pas) await client.query(
      "INSERT INTO pa (pa_code, agency_name, regional_code, regional_name, city, is_office, responsible_name, source_batch_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (pa_code) DO UPDATE SET agency_name = EXCLUDED.agency_name, regional_code = EXCLUDED.regional_code, regional_name = EXCLUDED.regional_name, city = EXCLUDED.city, is_office = EXCLUDED.is_office, responsible_name = EXCLUDED.responsible_name, source_batch_id = EXCLUDED.source_batch_id, updated_at = NOW()",
      [pa.code, pa.agency, pa.regionalCode, pa.regionalName, pa.city, pa.isOffice, pa.responsibleName, batchId]
    );
    await client.query("UPDATE import_batch SET status = 'PUBLICADO', record_count = $1, completed_at = NOW() WHERE id = $2", [data.employees.length, batchId]);
    await client.query("COMMIT");
    console.log(`Controle de Acessos importado: ${data.employees.length} colaboradores, ${data.roles.length} cargos e ${data.pas.length} PAs.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
