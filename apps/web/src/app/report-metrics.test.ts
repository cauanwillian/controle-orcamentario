import assert from "node:assert/strict";
import test from "node:test";
import { budgetMetrics, ledgerMetrics, variationTone } from "./report-metrics";

test("orçamento distingue execução de desvio e preserva orientação das despesas", () => {
  const revenue = budgetMetrics({ month: "2026-01-01", budget: 3622093.17, actual: 2770752.3 });
  assert.ok(Math.abs(revenue.variation + 851340.87) < .000001);
  assert.equal(Math.round((revenue.variationPercent ?? 0) * 100), 76);
  const expense = budgetMetrics({ month: "2026-01-01", budget: -6609710.24, actual: -6675535.93, variationDirection: -1 });
  assert.ok(Math.abs(expense.variation - 65825.69) < .000001);
  assert.equal(Math.round((expense.variationPercent ?? 0) * 100), 101);
});

test("razão utiliza a direção fornecida e a base anterior com sinal negativo", () => {
  const value = { month: "2026-02-01", budget: 0, actual: -458403.91, previousActual: -487865.98, variationDirection: -1 as const };
  const result = ledgerMetrics(value, 0, [value]);
  assert.ok(Math.abs(result.variation + 29462.07) < .000001);
  assert.equal(Math.round((result.variationPercent ?? 0) * 10000) / 100, -6.04);
});

test("um mês isolado conserva a base anterior e não fabrica percentual zero", () => {
  const value = { month: "2026-09-01", budget: 0, actual: 3666469.87, previousActual: 1642841.8 };
  const result = ledgerMetrics(value, 0, [value]);
  assert.ok(Math.abs(result.variation - 2023628.07) < .000001);
  assert.equal(Math.round((result.variationPercent ?? 0) * 10000) / 100, 123.18);
});

test("mês sem lançamento respeita os indicadores da API", () => {
  const value = { month: "2026-10-01", budget: 0, actual: 0, previousActual: 100, hasActual: false, variation: 0, variationPercent: null };
  assert.deepEqual(ledgerMetrics(value, 0, [value]), { previousActual: 100, variation: 0, variationPercent: null });
});

test("cores seguem o resultado financeiro mesmo com a variação orientada do Power BI", () => {
  const overBudgetExpense = budgetMetrics({ month: "2026-01-01", budget: -6609710.24, actual: -6675535.93, variationDirection: -1 });
  assert.equal(variationTone(overBudgetExpense.variation, -1), "negative-text");

  const lowerExpense = ledgerMetrics({ month: "2026-02-01", budget: 0, actual: -458403.91, previousActual: -487865.98, variationDirection: -1 }, 0, []);
  assert.equal(variationTone(lowerExpense.variation, -1), "positive-text");
  assert.equal(variationTone(2023628.07), "positive-text");
  assert.equal(variationTone(-851340.87), "negative-text");
  assert.equal(variationTone(0, -1), "");
});
