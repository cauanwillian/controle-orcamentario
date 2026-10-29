import assert from "node:assert/strict";
import { test } from "node:test";
import { DashboardService } from "./dashboard.service.js";

type Query = { sql: string; values: unknown[] };
function fixture(fullAccess = false) {
  const queries: Query[] = [];
  const service = Object.create(DashboardService.prototype) as DashboardService;
  Object.assign(service, {
    accessService: { resolve: async () => ({ employeeName: "Teste", roles: [], scopes: ["ADMINISTRATIVO"], fullAccess }) },
    pool: { query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values: [...values] });
      if (sql.includes("FROM app_setting")) return { rows: [{ setting_key: "ledger_accounting_lag_days", setting_value: "0" }] };
      if (sql.includes("MAX(posting_date)")) return { rows: [{ max_date: "2026-10-19" }] };
      if (sql.startsWith("SELECT COUNT(*)")) return { rows: [{ total: "0" }] };
      return { rows: [] };
    } }
  });
  return { service, queries };
}

test("searched budget uses scoped account/month/PA existence without joining duplicate entries", async () => {
  const { service, queries } = fixture();
  const data = await service.overview(2026, "group", {
    entrySearch: " R$ 1.234,56 ", entrySearchType: "amount", employeeCode: "1", paCode: "01", sectorName: "ADMINISTRATIVO", period: "2026-06"
  });
  assert.equal(data.filters.entrySearch, "R$ 1.234,56");
  assert.equal(data.filters.entrySearchType, "amount");
  const actual = queries.find(q => q.sql.includes("SUM(l.credit_amount - l.debit_amount)"))!;
  const budget = queries.find(q => q.sql.includes("SUM(b.amount)"))!;
  const actualWhere = actual.sql.split("WHERE ")[1].split("\n         GROUP BY")[0];
  assert.ok(budget.sql.includes(`WHERE ${actualWhere}`));
  for (const condition of ["EXISTS (", "l.account_code = b.account_code", "l.posting_date >= b.period_date", "l.posting_date < b.period_date + INTERVAL '1 month'", "= '4598' OR", "b.account_code ~ '^[78]\\.'"]) assert.ok(budget.sql.includes(condition), condition);
  assert.ok(!budget.sql.includes("b.source_account_name"));
  assert.ok(budget.sql.includes("GROUP BY b.period_date, COALESCE(a.group_name"));
  assert.ok(actual.sql.includes("a.access_scope_name = ANY($3::text[])"));
  assert.deepEqual(actual.values, budget.values);
  assert.equal(actual.values.at(-1), "1234.56");
  for (const query of [actual, budget]) assert.equal(Math.max(...[...query.sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]))), query.values.length);
});

test("no search preserves the original consolidated budget and no search clauses", async () => {
  const { service, queries } = fixture(true);
  await service.overview(2026, "group", {});
  const budget = queries.find(q => q.sql.includes("SUM(b.amount)"))!;
  assert.ok(budget.sql.includes("b.source_account_name AS dimension"));
  assert.ok(budget.sql.includes("b.pa_code = '4598'"));
  assert.ok(!budget.sql.includes("EXISTS"));
  assert.equal(budget.values.length, 2);
});

test("entry rows, PA summaries and total apply the same amount and permission conditions", async () => {
  const { service, queries } = fixture();
  await service.ledgerEntries(2026, "ADMINISTRATIVO", { paCode: "01", period: "2026-06", entrySearch: "36,00", entrySearchType: "amount", employeeCode: "1" });
  const entries = queries.filter(q => q.sql.includes("FROM ledger_entry_current l"));
  assert.equal(entries.length, 3);
  for (const query of entries) {
    assert.ok(query.sql.includes("a.access_scope_name = ANY($4::text[])"));
    assert.ok(query.sql.includes("ABS(l.debit_amount)"));
    assert.equal(query.values.at(-1), "36.00");
    assert.deepEqual(query.values, entries[0].values);
  }
});

test("group account details retain every hierarchy filter with exact entry search", async () => {
  const { service, queries } = fixture();
  await service.groupLedgerEntries(2026, "DESPESAS ADMINISTRATIVAS", { paCode: "01", sectorName: "ADMINISTRATIVO", subgroupName: "MATERIAIS", accountSearch: "8.1.7.24.00.00.0001-3", period: "2026-10", entrySearch: "000227", entrySearchType: "entry", employeeCode: "1" });
  const query = queries.find(q => q.sql.includes("FROM ledger_entry_current l"))!;
  for (const condition of ["a.group_name = $3", "a.access_scope_name = ANY($4::text[])", "a.sector_name = $5", "a.subgroup_name = $6", "l.account_code = $8", "l.posting_date >= $9::date", "LTRIM(BTRIM(l.entry_number), '0')"]) assert.ok(query.sql.includes(condition), condition);
  assert.equal(query.values.at(-1), "227");
  assert.ok(!query.sql.includes("LIMIT"));
});
