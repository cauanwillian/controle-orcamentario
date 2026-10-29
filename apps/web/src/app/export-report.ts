import type { Workbook } from "exceljs";

export type ExportValue = string | number | Date | null;
export type ExportMetadata = ReadonlyArray<readonly [string, ExportValue]>;
export type ExportColumn = { header: string; width?: number; format?: "text" | "currency" | "percent" | "date" | "datetime" | "number" };
export type ExportReport = {
  fileName: string;
  title: string;
  sheetName?: string;
  metadata: ExportMetadata;
  columns: ExportColumn[];
  rows: ExportValue[][];
  totalRow?: ExportValue[];
};

const formats = {
  text: "@",
  currency: '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00',
  percent: "0.0%;[Red]-0.0%;0.0%",
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  number: "#,##0.00",
};
const green = "00655F";

export const exportDate = (iso: string | null) => iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null;
export const makeExportFilename = (...parts: string[]) => `${parts.filter(Boolean).join("-").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 180) || "dashboard"}.xlsx`;

export async function createExcelWorkbook(report: ExportReport): Promise<Workbook> {
  if (!report.rows.length) throw new Error("Não há dados para exportar.");
  if (!report.columns.length || report.rows.length > 1_048_573) throw new Error("Quantidade de dados inválida para o arquivo Excel.");
  [...report.rows, ...(report.totalRow ? [report.totalRow] : [])].forEach(row => {
    if (row.length !== report.columns.length) throw new Error("As colunas do relatório estão incompletas.");
    row.forEach(value => {
      if ((typeof value === "number" && !Number.isFinite(value)) || (value instanceof Date && !Number.isFinite(value.getTime()))) throw new Error("O relatório contém um valor inválido.");
    });
  });
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Controle Orçamentário";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(report.sheetName ?? "Dados", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  sheet.columns = report.columns.map(column => ({ width: column.width ?? 20, style: { numFmt: formats[column.format ?? "text"] } }));
  sheet.addRow([report.title]);
  if (report.columns.length > 1) sheet.mergeCells(1, 1, 1, report.columns.length);
  sheet.getRow(1).height = 30;
  sheet.getCell(1, 1).font = { name: "Arial", size: 14, bold: true, color: { argb: green } };
  const header = sheet.addRow(report.columns.map(column => column.header));
  header.height = 32;
  header.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFF" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  report.rows.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.height = 26;
    row.eachCell({ includeEmpty: true }, (cell, columnIndex) => {
      const value = values[columnIndex - 1];
      cell.font = { name: "Arial", size: 10, color: { argb: typeof value === "number" && value < 0 ? "BE463F" : "123F43" } };
      cell.alignment = { vertical: "top", horizontal: typeof value === "number" ? "right" : "left", wrapText: true };
      if (index % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F1F8F5" } };
    });
    // Give long histories enough room while keeping short financial rows compact.
    const lines = Math.max(1, ...values.map((value, columnIndex) => typeof value === "string" ? Math.ceil(value.length / Math.max(10, (report.columns[columnIndex].width ?? 20) - 3)) : 1));
    row.height = Math.min(240, Math.max(26, lines * 15 + 8));
  });
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: report.rows.length + 2, column: report.columns.length } };
  if (report.totalRow) {
    const total = sheet.addRow(report.totalRow);
    total.height = 28;
    total.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "DEEEE7" } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: green } };
      cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "number" ? "right" : "left" };
    });
  }
  const filters = workbook.addWorksheet("Filtros", { views: [{ state: "frozen", ySplit: 1 }] });
  filters.columns = [{ width: 30 }, { width: 85 }];
  const filterHeader = filters.addRow(["Filtro", "Aplicado"]);
  filterHeader.height = 26;
  filterHeader.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFF" } };
  });
  const metadata: ExportMetadata = [["Relatório", report.title], ...report.metadata, ["Exportado em (UTC)", workbook.created]];
  metadata.forEach(([label, value]) => {
    const row = filters.addRow([label, value]);
    row.height = typeof value === "string" ? Math.max(24, Math.ceil(value.length / 80) * 16 + 8) : 24;
    row.font = { name: "Arial", size: 10, color: { argb: "123F43" } };
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(1).font = { ...row.font, bold: true };
    row.getCell(2).numFmt = value instanceof Date ? (label.startsWith("Exportado em") ? formats.datetime : formats.date) : typeof value === "string" ? "@" : "0";
  });
  return workbook;
}

export async function downloadExcelReport(report: ExportReport) {
  const workbook = await createExcelWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(new Uint8Array(buffer));
  const blob = new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = report.fileName;
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
}
