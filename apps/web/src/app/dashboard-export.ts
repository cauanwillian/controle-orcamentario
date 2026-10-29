import { makeExportFilename } from "./export-report";
import type { ExportColumn, ExportMetadata, ExportReport, ExportValue } from "./export-report";
import { budgetMetrics, ledgerMetrics } from "./report-metrics";
import type { ReportMonthlyValue } from "./report-metrics";

type MonthlyValue = ReportMonthlyValue;
type ExportRow = { label: string; values: MonthlyValue[]; budget: number; actual: number; variation: number; variationPercent: number | null };
type ExportDashboard = { months: string[]; rows: ExportRow[]; monthlyTotals?: MonthlyValue[]; totals: { budget: number; actual: number; variation: number; variationPercent: number | null } };
const periodLabel = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;

export function buildDashboardReport(data: ExportDashboard, options: { title: string; year: number; isBudget: boolean; label: string; metadata: ExportMetadata }): ExportReport {
  const metrics = options.isBudget ? ["Orçado", "Realizado", "Variação", "Execução (%)"] : ["Valor", "Variação", "%"];
  const columns: ExportColumn[] = [{ header: options.label, width: 48, format: "text" }];
  const isPercent = (metric: string) => metric === "%" || metric === "Execução (%)";
  data.months.forEach(period => metrics.forEach(metric => columns.push({ header: `${periodLabel(period)} ${metric}`, width: isPercent(metric) ? 16 : 21, format: isPercent(metric) ? "percent" : "currency" })));
  (options.isBudget ? metrics : ["Valor"]).forEach(metric => columns.push({ header: `Acumulado ${metric}`, width: isPercent(metric) ? 16 : 21, format: isPercent(metric) ? "percent" : "currency" }));
  const cells = (row: ExportRow): ExportValue[] => [row.label, ...row.values.flatMap((value, index) => {
    const { variation, variationPercent } = options.isBudget ? budgetMetrics(value) : ledgerMetrics(value, index, row.values);
    return options.isBudget ? [value.budget, value.actual, variation, variationPercent] : [value.actual, variation, variationPercent];
  }), ...(options.isBudget ? [row.budget, row.actual, row.variation, row.variationPercent] : [row.actual])];
  const totals: ExportRow = {
    ...data.totals,
    label: "Total",
    values: data.months.map(period => data.monthlyTotals?.find(value => value.month === period) ?? ({ month: period, budget: data.rows.reduce((sum, row) => sum + (row.values.find(value => value.month === period)?.budget ?? 0), 0), actual: data.rows.reduce((sum, row) => sum + (row.values.find(value => value.month === period)?.actual ?? 0), 0), previousActual: data.rows.some(row => row.values.find(value => value.month === period)?.previousActual !== undefined) ? data.rows.reduce((sum, row) => sum + (row.values.find(value => value.month === period)?.previousActual ?? 0), 0) : undefined })),
  };
  return { fileName: makeExportFilename(options.title, String(options.year)), title: options.title, sheetName: "Resumo mensal", metadata: options.metadata, columns, rows: data.rows.map(cells), totalRow: cells(totals) };
}
