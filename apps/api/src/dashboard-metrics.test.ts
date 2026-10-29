import assert from "node:assert/strict";
import { test } from "node:test";
import { DashboardService } from "./dashboard.service.js";

type AmountRow = { period: string; dimension: string; amount: string };
type RecordedQuery = { sql: string; values: unknown[] };
function fixture(current: AmountRow[], prior: AmountRow[] = [], budget: AmountRow[] = []) {
  const queries: RecordedQuery[] = [];
  const service = Object.create(DashboardService.prototype) as DashboardService;
  Object.assign(service, {
    accessService: { resolve: async () => ({ employeeName: "Teste", roles: [], scopes: ["ADMINISTRATIVO", "CADASTRO"], fullAccess: false }) },
    pool: { query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values: [...values] });
      if (sql.includes("FROM app_setting")) return { rows: [{ setting_key: "ledger_accounting_lag_days", setting_value: "0" }] };
      if (sql.includes("MAX(posting_date)")) return { rows: [{ max_date: "2026-10-13" }] };
      if (sql.includes("SUM(b.amount)")) return { rows: budget };
      if (sql.includes("SUM(l.credit_amount - l.debit_amount)")) return { rows: sql.includes("::date - INTERVAL '1 month'") ? prior : current };
      return { rows: [] };
    } },
  });
  return { service, queries };
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test("selected ledger month retains prior scope and search without exporting or accumulating the prior month", async () => {
  const { service, queries } = fixture(
    [{ period: "2026-08-01", dimension: "ADMINISTRATIVO", amount: "-557301.22" }],
    [{ period: "2026-07-01", dimension: "ADMINISTRATIVO", amount: "-583606.31" }, { period: "2026-07-01", dimension: "CADASTRO", amount: "-100.00" }]
  );
  const data = await service.overview(2026, "sector", { ledgerOnly: true, period: "2026-08", paCode: "01", reportDimension: "sector", entrySearch: "água" });
  assert.deepEqual(data.months, ["2026-08-01"]);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].label, "ADMINISTRATIVO");
  const value = data.rows[0].values[0];
  near(value.actual, -557301.22);
  near(value.previousActual, -583606.31);
  near(value.variation, -26305.09);
  assert.equal(value.variationDirection, -1);
  assert.equal(value.hasActual, true);
  assert.equal(value.hasBudget, false);
  near(data.totals.actual, -557301.22);
  // Totals include the prior month's complete authorized scope, even a dimension
  // that has no current-month matches and is intentionally absent from rows.
  near(data.monthlyTotals[0].previousActual, -583706.31);
  near(data.monthlyTotals[0].variation, 26405.09);
  assert.equal(data.monthlyTotals[0].variationDirection, 1);
  near(data.totals.previousActual, -583706.31);
  const actualQueries = queries.filter(query => query.sql.includes("SUM(l.credit_amount - l.debit_amount)"));
  assert.equal(actualQueries.length, 2);
  const previousQuery = actualQueries.find(query => query.sql.includes("::date - INTERVAL '1 month'"))!;
  const currentQuery = actualQueries.find(query => !query.sql.includes("::date - INTERVAL '1 month'"))!;
  assert.deepEqual(previousQuery.values, currentQuery.values);
  for (const query of actualQueries) {
    assert.ok(query.sql.includes("FROM ledger_entry_current l"));
    assert.ok(query.sql.includes("a.access_scope_name = ANY($3::text[])"));
    assert.ok(query.sql.includes("BTRIM(l.pa_code)"));
    assert.ok(query.sql.includes("COALESCE(l.history, '') <> 'VALOR REF. APURAÇÃO DE RESULTADO - DO SEMESTRE.'"));
    assert.equal(query.values.at(-1), "%agua%");
  }
  assert.ok(currentQuery.sql.includes("l.posting_date >= $5::date AND l.posting_date < ($5::date + INTERVAL '1 month')"));
  assert.ok(previousQuery.sql.includes("l.posting_date >= ($5::date - INTERVAL '1 month') AND l.posting_date < $5::date"));
});

test("January starts the fiscal comparison at zero and never queries December of the prior year", async () => {
  const { service, queries } = fixture([{ period: "2026-01-01", dimension: "TESOURARIA", amount: "2770752.30" }]);
  const data = await service.overview(2026, "group", { ledgerOnly: true, period: "2026-01", reportDimension: "group" });
  assert.equal(data.rows[0].values[0].previousActual, 0);
  assert.equal(data.rows[0].values[0].variationPercent, 0);
  near(data.rows[0].values[0].variation, 2770752.30);
  assert.equal(queries.filter(query => query.sql.includes("SUM(l.credit_amount - l.debit_amount)")).length, 1);
});

test("detail direction follows its concrete group even inside a sector with a different direction", async () => {
  const current = [{ period: "2026-08-01", dimension: "8.1 — DESPESA", amount: "-100.00" }];
  const budget = [{ period: "2026-08-01", dimension: "8.1 — DESPESA", amount: "-90.00" }];
  const groupFixture = fixture(current, [], budget);
  const groupReport = await groupFixture.service.overview(2026, "account", { reportDimension: "group", groupName: "DESPESAS ADMINISTRATIVAS", sectorName: "CADASTRO", period: "2026-08" });
  assert.equal(groupReport.rows[0].variationDirection, -1);
  assert.equal(groupReport.rows[0].values[0].variation, 10);
  const sectorFixture = fixture(current, [], budget);
  const sectorReport = await sectorFixture.service.overview(2026, "account", { reportDimension: "sector", groupName: "DESPESAS ADMINISTRATIVAS", sectorName: "CADASTRO", period: "2026-08" });
  assert.equal(sectorReport.rows[0].variationDirection, -1);
  assert.equal(sectorReport.rows[0].values[0].variation, 10);
  near(sectorReport.rows[0].variationPercent!, 100 / 90);
  assert.equal(sectorReport.totals.variationDirection, 1);
  assert.equal(sectorReport.totals.variation, -10);
});

test("monthly totals and unfiltered accumulated ledger metrics are recalculated, not sums of row percentages", async () => {
  const { service } = fixture([
    { period: "2026-07-01", dimension: "TESOURARIA", amount: "100.00" },
    { period: "2026-08-01", dimension: "TESOURARIA", amount: "120.00" },
    { period: "2026-07-01", dimension: "DESPESAS ADMINISTRATIVAS", amount: "-50.00" },
    { period: "2026-08-01", dimension: "DESPESAS ADMINISTRATIVAS", amount: "-60.00" },
  ]);
  const data = await service.overview(2026, "group", { ledgerOnly: true, reportDimension: "group" });
  const august = data.monthlyTotals.find(value => value.month === "2026-08-01")!;
  assert.equal(august.actual, 60);
  assert.equal(august.previousActual, 50);
  assert.equal(august.variation, 10);
  assert.equal(august.variationPercent, 0.2);
  assert.equal(data.totals.actual, 110);
  assert.equal(data.totals.variation, 110);
  assert.equal(data.totals.variationPercent, 0);
  const administrative = data.rows.find(row => row.label === "DESPESAS ADMINISTRATIVAS")!;
  assert.equal(administrative.actual, -110);
  assert.equal(administrative.variation, 110);
});
