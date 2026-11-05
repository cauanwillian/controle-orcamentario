import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../../.env") });

function dateInTimeZone(timeZone: string, point = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(point);
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

async function notifyPendingImport(payload: Record<string, unknown>) {
  const webhook = process.env.TEAMS_WEBHOOK_URL;
  if (!webhook) return { delivered: false, reason: "TEAMS_WEBHOOK_URL não configurada" };
  const reference = String(payload.expected_reference_date ?? "—");
  const latest = String(payload.latest_ledger_date ?? "não encontrada");
  const rejected = payload.latest_rejected_today as { filename: string; error_summary: string | null } | null;
  const rejectionText = rejected ? ` Último arquivo rejeitado hoje: ${rejected.filename}. Motivo: ${rejected.error_summary ?? "motivo não informado"}.` : "";
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: `⚠️ Controle Orçamentário: o Livro Razão está pendente após o prazo. Referência esperada: ${reference}; referência encontrada: ${latest}. Verifique o envio da Contabilidade.${rejectionText}` }),
  });
  if (!response.ok) throw new Error(`Falha ao enviar alerta para Teams (${response.status}).`);
  return { delivered: true };
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
    const [latest, upload, rejected] = await Promise.all([
      pool.query<{ posting_date: string | null; imported_at: string | null }>("SELECT MAX(posting_date)::text AS posting_date, MAX(updated_at)::text AS imported_at FROM ledger_entry_current"),
      pool.query<{ uploaded_at: string | null; uploader: string | null }>("SELECT u.uploaded_at::text, COALESCE(e.name, CASE WHEN u.upload_source='AUTOMATICO' THEN 'Rotina Automática' WHEN u.upload_source='CLI' THEN 'Importação CLI' ELSE 'Sistema' END) AS uploader FROM ledger_upload u LEFT JOIN employee e ON e.id=u.uploaded_by_employee_id ORDER BY u.uploaded_at DESC LIMIT 1"),
      pool.query<{ original_filename: string; error_summary: string | null }>("SELECT original_filename,error_summary FROM import_batch WHERE source_type='LIVRO_RAZAO' AND status='REJEITADO' AND (created_at AT TIME ZONE $1)::date=$2::date ORDER BY created_at DESC LIMIT 1", [timeZone, today])
    ]);
    const latestDate = latest.rows[0].posting_date;
    const latestUpload = upload.rows[0];
    const uploadedToday = latestUpload?.uploaded_at ? dateInTimeZone(timeZone, new Date(latestUpload.uploaded_at)) === today : false;
    const referenceStatus = latestDate && latestDate >= expectedReferenceDate ? "EM_DIA" : "PENDENTE";
    const status = uploadedToday && referenceStatus === "EM_DIA" ? "EM_DIA" : "PENDENTE";
    const latestRejected = rejected.rows[0];
    const payload = { time_zone: timeZone, import_deadline: deadline, lag_business_days: lagDays, expected_reference_date: expectedReferenceDate, latest_ledger_date: latestDate, latest_imported_at: latest.rows[0].imported_at, latest_upload_at: latestUpload?.uploaded_at ?? null, latest_uploader: latestUpload?.uploader ?? null, upload_received_today: uploadedToday, latest_rejected_today: latestRejected ? { filename: latestRejected.original_filename, error_summary: latestRejected.error_summary } : null, reference_status: referenceStatus, status };
    if (status !== "EM_DIA") {
      try { Object.assign(payload, { notification: await notifyPendingImport(payload) }); }
      catch (error) { Object.assign(payload, { notification: { delivered: false, reason: error instanceof Error ? error.message : "Falha desconhecida" } }); }
      process.exitCode = 2;
    }
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
