type Cell = { value: unknown; text: string };
type Row = { getCell(column: number): Cell };
type Worksheet = { getRow(row: number): Row; eachRow(callback: (row: Row, rowNumber: number) => void): void };
type Workbook = { getWorksheet(name: string): Worksheet | undefined };
type QueryResult<RowType = Record<string, unknown>> = { rows: RowType[]; rowCount: number | null };
type Queryable = { query<RowType = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<RowType>> };

export type LedgerSnapshotScope = {
  periodStart: string;
  periodEnd: string;
  accountFrom: string;
  accountTo: string;
  paCodes: string[];
  recordCount: number;
  cooperativeCode: string;
  sourceEmittedAt: string;
};
export type LedgerRow = {
  sourceKey: string; rowNumber: number; postingDate: string; accountCode: string; accountName: string | null;
  paCode: string; lotCode: string; entryNumber: string; groupingCode: string | null; history: string | null;
  debitAmount: number; creditAmount: number; balanceAmount: number | null; balanceNature: string | null;
};
declare const ledgerImport: {
  cellText(value: unknown): string | null;
  numeric(value: unknown, rowNumber: number, label: string, nullable?: boolean): number | null;
  postingDate(value: unknown, rowNumber: number): string;
  ledgerIdentityKey(date: string, account: string, pa: string, lot: string, entry: string): string;
  looksLikeLedgerEntry(row: Row): boolean;
  normalizeSnapshotPa(value: string): string;
  ledgerScopeContains(scope: LedgerSnapshotScope, row: { postingDate: string; accountCode: string; paCode: string }): boolean;
  parseLedgerSnapshotScope(sheet: Worksheet, rows: readonly { postingDate: string; accountCode: string; paCode: string }[]): LedgerSnapshotScope;
  parseLedgerWorkbook(workbook: Workbook): { rows: LedgerRow[]; skippedRows: number; scope: LedgerSnapshotScope };
  registerLedgerSnapshotScope(client: Queryable, batchId: string, scope: LedgerSnapshotScope): Promise<void>;
  insertLedgerEntries(client: Queryable, rows: LedgerRow[], accountIds: Map<string, string>, batchId: string, batchSize?: number): Promise<void>;
};
export = ledgerImport;
