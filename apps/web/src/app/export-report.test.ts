import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildDashboardReport } from "./dashboard-export";
import { buildEntryReport } from "./entry-export";
import { createExcelWorkbook, exportDate } from "./export-report";
import type { LedgerEntry } from "./entry-month-list";

const data = {
  months: ["2026-01-01", "2026-02-01"],
  rows: [{ label: "Grupo de teste", values: [{ month: "2026-01-01", budget: 100, actual: 80 }, { month: "2026-02-01", budget: 100, actual: 150 }], budget: 200, actual: 230, variation: 30, variationPercent: 1.15 }],
  totals: { budget: 200, actual: 230, variation: 30, variationPercent: 1.15 },
};
const entry: LedgerEntry = { posting_date: "2026-06-10", account_code: "8.1.7.03.00.00.0001-0", account_name: "Conta de teste", entry_number: "000000228", lot_code: "00001", history: '=HYPERLINK("https://example.invalid")', debitAmount: 36, creditAmount: 0, realized: -36 };

test("orçamento exporta valores e percentuais mensais e acumulados do painel", () => {
  const report = buildDashboardReport(data, { title: "Orçamento por grupos", year: 2026, isBudget: true, label: "Grupo", metadata: [["PA", "01"]] });
  assert.equal(report.columns.length, 13);
  assert.deepEqual(report.rows[0], ["Grupo de teste", 100, 80, -20, .8, 100, 150, 50, 1.5, 200, 230, 30, 1.15]);
  assert.deepEqual(report.totalRow?.slice(1), report.rows[0].slice(1));
});

test("razão usa variação entre meses e não a comparação com orçamento", () => {
  const report = buildDashboardReport(data, { title: "Razão por setores", year: 2026, isBudget: false, label: "Setor", metadata: [] });
  assert.equal(report.columns.length, 8);
  assert.deepEqual(report.rows[0], ["Grupo de teste", 80, 80, 0, 150, 70, .875, 230]);
});

test("razão exporta o mês selecionado com a base anterior sem incluí-la no acumulado", () => {
  const value = { month: "2026-09-01", budget: 0, actual: 3666469.87, previousActual: 1642841.8, variation: 2023628.07, variationPercent: 2023628.07 / 1642841.8 };
  const row = { label: "RECUPERAÇÃO DE PREJUÍZO", values: [value], budget: 0, actual: value.actual, variation: value.variation, variationPercent: value.variationPercent };
  const report = buildDashboardReport({ months: [value.month], rows: [row], monthlyTotals: [value], totals: row }, { title: "Razão", year: 2026, isBudget: false, label: "Grupo", metadata: [] });
  assert.deepEqual(report.rows[0], [row.label, 3666469.87, 2023628.07, value.variationPercent, 3666469.87]);
  assert.deepEqual(report.totalRow, ["Total", 3666469.87, 2023628.07, value.variationPercent, 3666469.87]);
});

test("orçamento preserva a variação orientada da API e o percentual de execução", () => {
  const value = { month: "2026-01-01", budget: -6609710.24, actual: -6675535.93, variation: 65825.69, variationPercent: -6675535.93 / -6609710.24 };
  const row = { label: "DESPESAS ADMINISTRATIVAS", values: [value], budget: value.budget, actual: value.actual, variation: value.variation, variationPercent: value.variationPercent };
  const report = buildDashboardReport({ months: [value.month], rows: [row], totals: row }, { title: "Orçamento", year: 2026, isBudget: true, label: "Grupo", metadata: [] });
  assert.deepEqual(report.rows[0].slice(1, 5), [value.budget, value.actual, 65825.69, value.variationPercent]);
  assert.equal(report.columns[4].header, "01/2026 Execução (%)");
});

test("exportação de lançamentos inclui apenas mês e dias selecionados", () => {
  const report = buildEntryReport([entry, { ...entry, posting_date: "2026-06-11", realized: -10 }, { ...entry, posting_date: "2026-07-10", realized: -20 }], "2026-06", ["2026-06-10"]);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0][1], "000000228");
  assert.equal(report.totalRow?.[8], -36);
  assert.equal(new Map(report.metadata).get("Dias selecionados"), "10/06/2026");
  assert.equal(new Map(report.metadata).get("Quantidade de lançamentos"), 1);
});

test("todos os dias inclui o mês inteiro, sem registros de outro mês", () => {
  const report = buildEntryReport([entry, { ...entry, posting_date: "2026-06-11", realized: -10 }, { ...entry, posting_date: "2026-07-10", realized: -20 }], "2026-06", []);
  assert.equal(report.rows.length, 2);
  assert.equal(report.totalRow?.[8], -46);
  assert.equal(new Map(report.metadata).get("Dias selecionados"), "Todos os dias");
});

test("arquivo salvo preserva datas, números, zeros iniciais e histórico como texto", async () => {
  const report = buildEntryReport([entry], "2026-06", ["2026-06-10"], [["PA", "01"], ["Data contábil de referência", exportDate("2026-06-30")]]);
  const original = await createExcelWorkbook(report);
  const buffer = await original.xlsx.writeBuffer();
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(buffer);
  const sheet = saved.getWorksheet("Lançamentos")!;
  assert.ok(sheet.getCell("A3").value instanceof Date);
  assert.equal((sheet.getCell("A3").value as Date).toISOString().slice(0, 10), "2026-06-10");
  assert.equal(sheet.getCell("B3").value, "000000228");
  assert.equal(sheet.getCell("C3").value, "00001");
  assert.equal(sheet.getCell("D3").value, entry.account_code);
  assert.equal(sheet.getCell("F3").value, entry.history);
  assert.equal(sheet.getCell("F3").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("G3").value, 36);
  assert.equal(sheet.getCell("I3").value, -36);
  assert.equal(sheet.getCell("I4").value, -36);
  assert.equal(saved.getWorksheet("Filtros")!.getCell("B3").value, "01");
});

test("bloqueia arquivo vazio ou com número inválido", async () => {
  await assert.rejects(createExcelWorkbook(buildEntryReport([], "2026-06", [])), /Não há dados/);
  await assert.rejects(createExcelWorkbook(buildEntryReport([{ ...entry, realized: Number.NaN }], "2026-06", [])), /valor inválido/);
});
