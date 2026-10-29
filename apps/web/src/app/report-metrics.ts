export type ReportMonthlyValue = {
  month: string;
  budget: number;
  actual: number;
  previousActual?: number;
  variation?: number;
  variationPercent?: number | null;
  variationDirection?: 1 | -1;
  hasActual?: boolean;
  hasBudget?: boolean;
};

export function variationTone(variation: number, direction: 1 | -1 = 1) {
  const change = variation * direction;
  return !Number.isFinite(change) || change === 0 ? "" : change > 0 ? "positive-text" : "negative-text";
}

export function budgetMetrics(value: ReportMonthlyValue) {
  const variation = value.variation ?? (value.variationDirection ?? 1) * (value.actual - value.budget);
  const variationPercent = value.variationPercent !== undefined
    ? value.variationPercent
    : value.hasActual === false ? null : value.budget === 0 ? (value.actual === 0 ? null : 0) : value.actual / value.budget;
  return { variation, variationPercent };
}

export function ledgerMetrics(value: ReportMonthlyValue, index: number, values: readonly ReportMonthlyValue[]) {
  const previousActual = value.previousActual ?? (index ? values[index - 1].actual : 0);
  const variation = value.variation ?? (value.hasActual === false ? 0 : (value.variationDirection ?? 1) * (value.actual - previousActual));
  const variationPercent = value.variationPercent !== undefined
    ? value.variationPercent
    : value.hasActual === false ? null : previousActual === 0 ? 0 : variation / Math.abs(previousActual);
  return { previousActual, variation, variationPercent };
}
