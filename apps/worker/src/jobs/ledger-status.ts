import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

function dateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function previousBusinessDays(today: string, count: number, holidays: Set<string>) {
  const date = new Date(`${today}T00:00:00.000Z`);
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const iso = date.toISOString().slice(0, 10);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(iso)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não foi definida no arquivo .env.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const settings = await pool.query<{ setting_key: string; setting_value: string }>("SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN ('business_timezone', 'ledger_accounting_lag_days', 'ledger_import_deadline')");
    const config = new Map(settings.rows.map((setting) => [setting.setting_key, setting.setting_value]));
    const timeZone = config.get("business_timezone") ?? "America/Cuiaba";
    const lagDays = Number(config.get("ledger_accounting_lag_days") ?? "3");
    const deadline = config.get("ledger_import_deadline") ?? "09:00";
    if (!Number.isInteger(lagDays) || lagDays < 0) throw new Error("ledger_accounting_lag_days deve ser um número inteiro não negativo.");
    const holidays = await pool.query<{ holiday_date: string }>("SELECT holiday_date::text FROM business_holiday");
    const today = dateInTimeZone(timeZone);
    const expectedReferenceDate = previousBusinessDays(today, lagDays, new Set(holidays.rows.map((holiday) => holiday.holiday_date)));
    const latest = await pool.query<{ posting_date: string | null; imported_at: string | null }>("SELECT MAX(posting_date)::text AS posting_date, MAX(updated_at)::text AS imported_at FROM ledger_entry");
    const latestDate = latest.rows[0].posting_date;
    const status = latestDate && latestDate >= expectedReferenceDate ? "EM_DIA" : "PENDENTE";
    console.log(JSON.stringify({ time_zone: timeZone, import_deadline: deadline, lag_business_days: lagDays, expected_reference_date: expectedReferenceDate, latest_ledger_date: latestDate, status }, null, 2));
    if (status !== "EM_DIA") process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
