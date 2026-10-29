import { exportDate, makeExportFilename } from "./export-report";
import type { ExportMetadata, ExportReport } from "./export-report";
import type { LedgerEntry } from "./entry-month-list";

export function buildEntryReport(entries: LedgerEntry[], month: string, selectedDates: string[], metadata: ExportMetadata = []): ExportReport {
  const dates = [...selectedDates].sort();
  const includedDates = new Set(dates);
  const reportEntries = entries.filter(entry => entry.posting_date.startsWith(`${month}-`) && (!dates.length || includedDates.has(entry.posting_date)));
  const account = reportEntries[0];
  const asDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  return {
    fileName: makeExportFilename("lancamentos", month, account?.account_code ?? "", dates.length ? `dias-${dates.map(value => value.slice(8, 10)).join("-")}` : "mes-completo"),
    title: "Lançamentos por data",
    sheetName: "Lançamentos",
    metadata: [...metadata, ["Mês", `${month.slice(5, 7)}/${month.slice(0, 4)}`], ["Dias selecionados", dates.length ? dates.map(asDate).join(", ") : "Todos os dias"], ["Conta", account?.account_code ?? "—"], ["Descrição da conta", account?.account_name ?? "—"], ["Quantidade de lançamentos", reportEntries.length]],
    columns: [{ header: "Data", width: 15, format: "date" }, { header: "Lançamento", width: 18, format: "text" }, { header: "Lote", width: 16, format: "text" }, { header: "Conta", width: 27, format: "text" }, { header: "Nome da conta", width: 48, format: "text" }, { header: "Histórico", width: 90, format: "text" }, { header: "Débito", width: 21, format: "currency" }, { header: "Crédito", width: 21, format: "currency" }, { header: "Realizado", width: 21, format: "currency" }],
    rows: [...reportEntries].sort((left, right) => right.posting_date.localeCompare(left.posting_date)).map(entry => [exportDate(entry.posting_date), entry.entry_number || entry.lot_code || "—", entry.lot_code, entry.account_code, entry.account_name, entry.history || "Sem histórico informado", entry.debitAmount, entry.creditAmount, entry.realized]),
    totalRow: ["Total", null, null, null, null, null, reportEntries.reduce((sum, entry) => sum + entry.debitAmount, 0), reportEntries.reduce((sum, entry) => sum + entry.creditAmount, 0), reportEntries.reduce((sum, entry) => sum + entry.realized, 0)],
  };
}
