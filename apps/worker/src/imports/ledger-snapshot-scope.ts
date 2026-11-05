import ledgerImport from "@orcamento/shared/ledger-import";

export type { LedgerSnapshotScope } from "@orcamento/shared/ledger-import";
export const looksLikeLedgerEntry = ledgerImport.looksLikeLedgerEntry;
export const normalizeSnapshotPa = ledgerImport.normalizeSnapshotPa;
export const ledgerScopeContains = ledgerImport.ledgerScopeContains;
export const parseLedgerSnapshotScope = ledgerImport.parseLedgerSnapshotScope;
export const registerLedgerSnapshotScope = ledgerImport.registerLedgerSnapshotScope;
