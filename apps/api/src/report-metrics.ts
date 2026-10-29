export type ReportDimension = "group" | "sector";
export type VariationDirection = 1 | -1;

const key = (value: string) => value.normalize("NFD").replace(/\p{M}|\s/gu, "").toLocaleUpperCase("pt-BR");
const invertedGroups = new Set([
  "DESPESA ORIGEM DE RECURSO", "OUTRAS DESPESAS OPERACIONAIS",
  "DESPESAS ADMINISTRATIVAS", "DESPESAS NÃO OPERACIONAIS",
].map(key));
const invertedSectors = new Set([
  "ADMINISTRATIVO", "CONTROLESINTERNOS", "D.P./G.P.", "FINANCEIRO", "GOVERNANÇA",
  "JURÍDICO", "MANUTENÇÃO E EXPANSÃO", "MKT", "RECUPERAÇÃO", "T.I.",
].map(key));

/** Direction is a report classification, not the sign of a transaction. */
export function reportVariationDirection(dimension: ReportDimension, label?: string): VariationDirection {
  if (!label) return 1;
  return (dimension === "sector" ? invertedSectors : invertedGroups).has(key(label)) ? -1 : 1;
}

export function budgetReportMetrics(budget: number, actual: number, direction: VariationDirection = 1) {
  return {
    variation: (actual - budget) * direction,
    variationPercent: budget === 0 ? (actual === 0 ? null : 0) : actual / budget,
  };
}

export function ledgerReportMetrics(previousActual: number, actual: number, direction: VariationDirection = 1, hasActual = true) {
  const variation = hasActual ? (actual - previousActual) * direction : 0;
  return {
    variation,
    variationPercent: !hasActual ? null : previousActual === 0 ? 0 : variation / Math.abs(previousActual),
  };
}

export function previousReportMonth(month: string) {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 10);
}
