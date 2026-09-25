import { Injectable, OnModuleDestroy } from "@nestjs/common";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { AccessService } from "./access.service.js";

const localEnv = path.resolve(process.cwd(), ".env");
dotenv.config({ path: existsSync(localEnv) ? localEnv : path.resolve(process.cwd(), "../../.env") });

type Dimension = "group" | "subgroup" | "sector" | "pa" | "account";
type OverviewFilters = { paCode?: string; sectorName?: string; groupName?: string; subgroupName?: string; period?: string; accountSearch?: string; employeeCode?: string };

function localDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function businessCutoff(today: string, businessDays: number, holidays: Set<string>) {
  const date = new Date(`${today}T00:00:00.000Z`);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    const iso = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(iso)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class DashboardService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly accessService = new AccessService();

  async filters(year: number, employeeCode?: string) {
    const viewer = await this.accessService.resolve(employeeCode);
    const scopeCondition = viewer.fullAccess ? "" : " AND a.access_scope_name = ANY($2::text[])";
    const scopeValues = viewer.fullAccess ? [year] : [year, viewer.scopes];
    const [years, pas, sectors] = await Promise.all([
      this.pool.query<{ year: number }>("SELECT fiscal_year AS year FROM budget_version ORDER BY fiscal_year DESC"),
      this.pool.query<{ code: string; label: string }>(
        `SELECT DISTINCT b.pa_code AS code, COALESCE(p.agency_name, 'PA ' || b.pa_code) AS label
         FROM budget_entry b JOIN budget_version v ON v.id = b.budget_version_id
         LEFT JOIN pa p ON p.pa_code = b.pa_code LEFT JOIN account a ON a.id = b.account_id
         WHERE v.fiscal_year = $1${scopeCondition} ORDER BY b.pa_code`,
        scopeValues
      ),
      this.pool.query<{ name: string }>(`SELECT DISTINCT sector_name AS name FROM account WHERE sector_name IS NOT NULL${viewer.fullAccess ? "" : " AND access_scope_name = ANY($1::text[])"} ORDER BY sector_name`, viewer.fullAccess ? [] : [viewer.scopes])
    ]);
    const orderedPas = pas.rows.sort((a, b) => {
      const aNumber = Number(a.code), bNumber = Number(b.code);
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
      return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
    });
    return { years: years.rows.map((row) => row.year), pas: orderedPas, sectors: sectors.rows.map((row) => row.name) };
  }

  async overview(year: number, dimension: Dimension, filters: OverviewFilters = {}) {
    const viewer = await this.accessService.resolve(filters.employeeCode);
    const field = dimension === "sector" ? "sector_name" : dimension === "subgroup" ? "subgroup_name" : "group_name";
    const budgetDimension = dimension === "group" ? "b.source_account_name" : dimension === "pa" ? "b.pa_code" : dimension === "account" ? "COALESCE(a.account_code || ' — ' || a.account_name, b.account_code || ' — Não mapeada')" : `COALESCE(a.${field}, 'Sem classificação')`;
    const actualDimension = dimension === "pa" ? "l.pa_code" : dimension === "account" ? "COALESCE(a.account_code || ' — ' || a.account_name, l.account_code || ' — Não mapeada')" : `COALESCE(a.${field}, 'Sem classificação')`;
    const [settingsResult, holidaysResult, latestResult] = await Promise.all([
      this.pool.query<{ setting_key: string; setting_value: string }>("SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN ('business_timezone', 'ledger_accounting_lag_days', 'ledger_import_deadline')"),
      this.pool.query<{ holiday_date: string }>("SELECT holiday_date::text FROM business_holiday"),
      this.pool.query<{ max_date: string | null }>("SELECT MAX(posting_date)::text AS max_date FROM ledger_entry")
    ]);
    const settings = new Map(settingsResult.rows.map((row) => [row.setting_key, row.setting_value]));
    const timeZone = settings.get("business_timezone") ?? "America/Cuiaba";
    const lagDays = Number(settings.get("ledger_accounting_lag_days") ?? "3");
    const cutoff = businessCutoff(localDate(timeZone), lagDays, new Set(holidaysResult.rows.map((row) => row.holiday_date)));
    const reportingDate = cutoff < `${year}-01-01` ? `${year}-01-01` : cutoff > `${year}-12-31` ? `${year}-12-31` : cutoff;

    if (filters.period && !new RegExp(`^${year}-(0[1-9]|1[0-2])$`).test(filters.period)) throw new Error("Período inválido para o ano selecionado.");
    const budgetConditions = ["v.fiscal_year = $1", "b.period_date <= date_trunc('month', $2::date)::date"];
    const actualConditions = ["l.posting_date >= make_date($1, 1, 1)", "l.posting_date <= $2::date"];
    const queryValues: unknown[] = [year, reportingDate];
    if (!viewer.fullAccess) {
      queryValues.push(viewer.scopes);
      budgetConditions.push(`a.access_scope_name = ANY($${queryValues.length}::text[])`);
      actualConditions.push(`a.access_scope_name = ANY($${queryValues.length}::text[])`);
    }
    if (filters.paCode) {
      queryValues.push(filters.paCode);
      budgetConditions.push(`b.pa_code = $${queryValues.length}`);
      actualConditions.push(`NULLIF(LTRIM(l.pa_code, '0'), '') = NULLIF(LTRIM($${queryValues.length}::text, '0'), '')`);
    } else if (dimension !== "pa") {
      // A PA 4598 é o orçamento consolidado. Somar suas PAs filhas duplica o orçamento.
      budgetConditions.push("b.pa_code = '4598'");
    }
    if (filters.sectorName) {
      queryValues.push(filters.sectorName);
      budgetConditions.push(`a.sector_name = $${queryValues.length}`);
      actualConditions.push(`a.sector_name = $${queryValues.length}`);
    }
    if (filters.groupName) {
      queryValues.push(filters.groupName);
      budgetConditions.push(`a.group_name = $${queryValues.length}`);
      actualConditions.push(`a.group_name = $${queryValues.length}`);
    }
    if (filters.subgroupName) {
      queryValues.push(filters.subgroupName);
      budgetConditions.push(`a.subgroup_name = $${queryValues.length}`);
      actualConditions.push(`a.subgroup_name = $${queryValues.length}`);
    }
    if (filters.accountSearch) {
      queryValues.push(`%${filters.accountSearch.trim()}%`);
      budgetConditions.push(`(b.account_code ILIKE $${queryValues.length} OR a.account_name ILIKE $${queryValues.length})`);
      actualConditions.push(`(l.account_code ILIKE $${queryValues.length} OR a.account_name ILIKE $${queryValues.length})`);
    }
    if (filters.period) {
      queryValues.push(`${filters.period}-01`);
      budgetConditions.push(`b.period_date = $${queryValues.length}::date`);
      actualConditions.push(`l.posting_date >= $${queryValues.length}::date AND l.posting_date < ($${queryValues.length}::date + INTERVAL '1 month')`);
    }
    if (dimension === "group" && !filters.sectorName && !filters.accountSearch) {
      // O arquivo traz uma linha consolidada para cada grupo. Ela é a fonte correta desta visão.
      budgetConditions.push("b.source_account_name IN (SELECT DISTINCT group_name FROM account WHERE group_name IS NOT NULL)");
    } else {
      // Os códigos 3, 4 e 5 da planilha são linhas de grupo/subtotal. As contas analíticas do orçamento começam em 7 ou 8.
      budgetConditions.push("b.account_code ~ '^[78]\\.'");
    }
    const [budgetResult, actualResult] = await Promise.all([
      this.pool.query<{ period: string; dimension: string; amount: string }>(
        `SELECT b.period_date::text AS period, ${budgetDimension} AS dimension, SUM(b.amount)::text AS amount
         FROM budget_entry b
         JOIN budget_version v ON v.id = b.budget_version_id
         LEFT JOIN account a ON a.id = b.account_id
         WHERE ${budgetConditions.join(" AND ")}
         GROUP BY b.period_date, ${budgetDimension}`,
        queryValues
      ),
      this.pool.query<{ period: string; dimension: string; amount: string }>(
        `SELECT date_trunc('month', l.posting_date)::date::text AS period, ${actualDimension} AS dimension,
                SUM(l.credit_amount - l.debit_amount)::text AS amount
         FROM ledger_entry l
         LEFT JOIN account a ON a.id = l.account_id
         WHERE ${actualConditions.join(" AND ")}
         GROUP BY date_trunc('month', l.posting_date)::date, ${actualDimension}`,
        queryValues
      )
    ]);

    const months = filters.period ? [`${filters.period}-01`] : Array.from({ length: Number(reportingDate.slice(5, 7)) }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}-01`);
    const rows = new Map<string, { label: string; budget: Map<string, number>; actual: Map<string, number> }>();
    for (const entry of budgetResult.rows) {
      const row = rows.get(entry.dimension) ?? { label: entry.dimension, budget: new Map(), actual: new Map() };
      row.budget.set(entry.period, Number(entry.amount));
      rows.set(entry.dimension, row);
    }
    for (const entry of actualResult.rows) {
      const row = rows.get(entry.dimension) ?? { label: entry.dimension, budget: new Map(), actual: new Map() };
      row.actual.set(entry.period, Number(entry.amount));
      rows.set(entry.dimension, row);
    }
    const data = [...rows.values()].map((row) => {
      const values = months.map((month) => ({ month, budget: row.budget.get(month) ?? 0, actual: row.actual.get(month) ?? 0 }));
      const budget = values.reduce((sum, value) => sum + value.budget, 0);
      const actual = values.reduce((sum, value) => sum + value.actual, 0);
      return { label: row.label, values, budget, actual, variation: actual - budget, variationPercent: budget === 0 ? null : (actual - budget) / Math.abs(budget) };
    }).sort((a, b) => dimension === "pa" ? Number(a.label) - Number(b.label) : Math.abs(b.variation) - Math.abs(a.variation));
    const budget = data.reduce((sum, row) => sum + row.budget, 0);
    const actual = data.reduce((sum, row) => sum + row.actual, 0);
    return {
      year,
      dimension,
      filters,
      viewer: { employeeName: viewer.employeeName, roles: viewer.roles, fullAccess: viewer.fullAccess },
      reportingDate,
      importDeadline: settings.get("ledger_import_deadline") ?? "09:00",
      latestLedgerDate: latestResult.rows[0].max_date,
      totals: { budget, actual, variation: actual - budget, variationPercent: budget === 0 ? null : (actual - budget) / Math.abs(budget) },
      months,
      rows: data
    };
  }

  async ledgerEntries(year: number, sectorName: string, filters: OverviewFilters = {}) {
    const viewer = await this.accessService.resolve(filters.employeeCode);
    const [settingsResult, holidaysResult] = await Promise.all([
      this.pool.query<{ setting_key: string; setting_value: string }>("SELECT setting_key, setting_value FROM app_setting WHERE setting_key IN ('business_timezone', 'ledger_accounting_lag_days')"),
      this.pool.query<{ holiday_date: string }>("SELECT holiday_date::text FROM business_holiday")
    ]);
    const settings = new Map(settingsResult.rows.map((row) => [row.setting_key, row.setting_value]));
    const cutoff = businessCutoff(localDate(settings.get("business_timezone") ?? "America/Cuiaba"), Number(settings.get("ledger_accounting_lag_days") ?? "3"), new Set(holidaysResult.rows.map((row) => row.holiday_date)));
    const reportingDate = cutoff < `${year}-01-01` ? `${year}-01-01` : cutoff > `${year}-12-31` ? `${year}-12-31` : cutoff;
    const conditions = ["l.posting_date >= make_date($1, 1, 1)", "l.posting_date <= $2::date", "a.sector_name = $3"];
    const values: unknown[] = [year, reportingDate, sectorName];
    if (!viewer.fullAccess) {
      values.push(viewer.scopes);
      conditions.push(`a.access_scope_name = ANY($${values.length}::text[])`);
    }
    if (filters.paCode) {
      values.push(filters.paCode);
      conditions.push(`NULLIF(LTRIM(l.pa_code, '0'), '') = NULLIF(LTRIM($${values.length}::text, '0'), '')`);
    }
    if (filters.accountSearch) {
      values.push(`%${filters.accountSearch.trim()}%`);
      conditions.push(`(l.account_code ILIKE $${values.length} OR COALESCE(a.account_name, l.account_name) ILIKE $${values.length})`);
    }
    if (filters.period) {
      values.push(`${filters.period}-01`);
      conditions.push(`l.posting_date >= $${values.length}::date AND l.posting_date < ($${values.length}::date + INTERVAL '1 month')`);
    }
    const where = conditions.join(" AND ");
    const [entriesResult, paResult, totalResult] = await Promise.all([
      this.pool.query<{ posting_date: string; pa_code: string; account_code: string; account_name: string; history: string | null; lot_code: string; entry_number: string; debit_amount: string; credit_amount: string; realized: string }>(
        `SELECT l.posting_date::text, l.pa_code, l.account_code, COALESCE(a.account_name, l.account_name, l.account_code) AS account_name,
                l.history, l.lot_code, l.entry_number, l.debit_amount::text, l.credit_amount::text, (l.credit_amount - l.debit_amount)::text AS realized
         FROM ledger_entry l LEFT JOIN account a ON a.id = l.account_id WHERE ${where}
         ORDER BY l.posting_date DESC, l.entry_number DESC LIMIT ${filters.paCode ? 150 : 0}`, values
      ),
      this.pool.query<{ pa_code: string; total: string; realized: string }>(
        `SELECT l.pa_code, COUNT(*)::text AS total, SUM(l.credit_amount - l.debit_amount)::text AS realized
         FROM ledger_entry l LEFT JOIN account a ON a.id = l.account_id WHERE ${where}
         GROUP BY l.pa_code ORDER BY l.pa_code`, values
      ),
      this.pool.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ledger_entry l LEFT JOIN account a ON a.id = l.account_id WHERE ${where}`, values)
    ]);
    return {
      sectorName,
      reportingDate,
      total: Number(totalResult.rows[0].total),
      pas: paResult.rows.map((row) => ({ paCode: row.pa_code, total: Number(row.total), realized: Number(row.realized) })),
      entries: entriesResult.rows.map((row) => ({ ...row, debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount), realized: Number(row.realized) }))
    };
  }

  async onModuleDestroy() {
    await this.accessService.onModuleDestroy();
    await this.pool.end();
  }
}
