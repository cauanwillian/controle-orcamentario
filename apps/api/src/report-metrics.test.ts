import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetReportMetrics, ledgerReportMetrics, previousReportMonth, reportVariationDirection } from "./report-metrics.js";

const near = (actual: number | null, expected: number, delta = 0.000001) => assert.ok(actual !== null && Math.abs(actual - expected) <= delta, `${actual} != ${expected}`);

test("Power BI variation direction follows report classification, including positive reversals", () => {
  for (const label of ["DESPESA ORIGEM DE RECURSO", "OUTRAS DESPESAS OPERACIONAIS", "DESPESAS ADMINISTRATIVAS", "DESPESAS NÃO OPERACIONAIS"]) assert.equal(reportVariationDirection("group", label), -1);
  for (const label of ["TESOURARIA", "OPERAÇÕES DE CRÉDITO", "CPR", "PROVISÃO/REVERSÃO DE CL/GARANTIAS PRESTADAS", "RECUPERAÇÃO DE PREJUÍZO", "OUTRAS RECEITAS OPERACIONAIS", "RECEITAS NÃO OPERACIONAIS"]) assert.equal(reportVariationDirection("group", label), 1);
  for (const label of ["CADASTRO", "CONTABILIDADE", "CRÉDITO", "NEGÓCIOS"]) assert.equal(reportVariationDirection("sector", label), 1);
  for (const label of ["ADMINISTRATIVO", "CONTROLESINTERNOS", "D.P./G.P.", "FINANCEIRO", "GOVERNANÇA", "JURÍDICO", "MANUTENÇÃOEEXPANSÃO", "MKT", "RECUPERAÇÃO", "T.I."]) assert.equal(reportVariationDirection("sector", label), -1);
  assert.equal(reportVariationDirection("sector", " manutenção e expansão "), -1);
});

test("budget percentage is execution and variation respects direction", () => {
  const treasury = budgetReportMetrics(3_622_093.17, 2_770_752.30);
  near(treasury.variation, -851_340.87);
  near(treasury.variationPercent, 0.764959, 0.00001);
  const administrative = budgetReportMetrics(-6_609_710.24, -6_675_535.93, -1);
  near(administrative.variation, 65_825.69);
  near(administrative.variationPercent, 1.009959, 0.00001);
  const reversal = budgetReportMetrics(-4_748_255.98, 2_890_412.32, 1);
  near(reversal.variation, 7_638_668.30);
  near(reversal.variationPercent, -0.608731, 0.00001);
  assert.equal(budgetReportMetrics(0, 419_570.58).variationPercent, 0);
  assert.equal(budgetReportMetrics(0, 0).variationPercent, null);
});

test("ledger percentage is oriented variation over absolute prior, not a universal signed ratio", () => {
  const administrative = ledgerReportMetrics(-487_865.98, -458_403.91, -1);
  near(administrative.variation, -29_462.07);
  near(administrative.variationPercent, -0.060389, 0.00001);
  const registration = ledgerReportMetrics(-17_300.13, -856.70, 1);
  near(registration.variation, 16_443.43);
  near(registration.variationPercent, 0.95048, 0.00001);
  const reversal = ledgerReportMetrics(477_448.74, -62_247.40, -1);
  near(reversal.variation, 539_696.14);
  near(reversal.variationPercent, 1.130375, 0.00001);
  const provision = ledgerReportMetrics(-6_322_618.01, -9_290_686.30, 1);
  near(provision.variationPercent, -0.469436, 0.00001);
  assert.deepEqual(ledgerReportMetrics(0, -487_865.98, -1), { variation: 487_865.98, variationPercent: 0 });
  assert.deepEqual(ledgerReportMetrics(-100, 0, -1, false), { variation: 0, variationPercent: null });
});

test("previous month keeps UTC month boundaries", () => {
  assert.equal(previousReportMonth("2026-09-01"), "2026-08-01");
  assert.equal(previousReportMonth("2026-01-01"), "2025-12-01");
});
