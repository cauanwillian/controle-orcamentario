import type ExcelJS from "exceljs";
import type { PoolClient } from "pg";

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
type ScopeRow = { postingDate: string; accountCode: string; paCode: string };
const accountPattern = /^[0-9]\.[0-9]\.[0-9]\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}-[0-9]$/;

export function looksLikeLedgerEntry(row: ExcelJS.Row) {
  return [2, 3, 4].every(column => /^[0-9]+$/.test(row.getCell(column).text.trim()));
}

export function normalizeSnapshotPa(value: string) {
  const code = value.trim();
  if (!/^[0-9]+$/.test(code)) throw new Error("O escopo do Livro Razão contém PA inválida.");
  return code.replace(/^0+(?=\d)/, "");
}

function sourceDate(value: string) {
  const [day, month, year] = value.split("/");
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error("Período inválido no cabeçalho do Livro Razão.");
  return iso;
}

/** An observed PA replaces only its declared date/account interval. Missing PAs remain untouched. */
export function ledgerScopeContains(scope: LedgerSnapshotScope, row: ScopeRow) {
  return row.postingDate >= scope.periodStart && row.postingDate <= scope.periodEnd
    && accountPattern.test(row.accountCode) && row.accountCode >= scope.accountFrom && row.accountCode <= scope.accountTo
    && scope.paCodes.includes(normalizeSnapshotPa(row.paCode));
}

export function parseLedgerSnapshotScope(sheet: ExcelJS.Worksheet, rows: readonly ScopeRow[]): LedgerSnapshotScope {
  const value = (row: number, column: number) => sheet.getRow(row).getCell(column).text.trim();
  if (value(5, 1) !== "Período:" || value(5, 5) !== "Contas:" || value(6, 1) !== "Forma de Pesquisa:" || value(6, 2) !== "Conta Contábil" || value(6, 5) !== "Totalizar Por:" || value(6, 6) !== "-") {
    throw new Error("Cabeçalho de escopo não reconhecido. Envie o Livro Razão por Conta Contábil, sem totalização.");
  }
  const period = value(5, 2).match(/^(\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})$/);
  const accounts = value(5, 6).match(/^([^ ]+) a ([^ ]+)$/);
  if (!period || !accounts || !accountPattern.test(accounts[1]) || !accountPattern.test(accounts[2])) throw new Error("Período ou intervalo de contas ausente/inválido no Livro Razão.");
  const cooperativeCode = value(4, 1).match(/^([0-9]+) - /)?.[1];
  const emissionDate = value(2, 9), emissionTime = value(4, 9);
  if (cooperativeCode !== "4598") throw new Error("O Livro Razão não pertence à cooperativa 4598.");
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(emissionDate) || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(emissionTime)) throw new Error("Data ou hora de emissão ausente/inválida no Livro Razão.");
  const scope: LedgerSnapshotScope = {
    periodStart: sourceDate(period[1]), periodEnd: sourceDate(period[2]), accountFrom: accounts[1], accountTo: accounts[2],
    paCodes: [...new Set(rows.map(row => normalizeSnapshotPa(row.paCode)))].sort((a, b) => Number(a) - Number(b)), recordCount: rows.length,
    cooperativeCode, sourceEmittedAt: `${sourceDate(emissionDate)}T${emissionTime}`,
  };
  if (!scope.recordCount || scope.periodStart > scope.periodEnd || scope.accountFrom > scope.accountTo) throw new Error("Escopo vazio ou invertido no Livro Razão.");
  if (rows.some(row => !ledgerScopeContains(scope, row))) throw new Error("Há lançamentos fora do período ou intervalo de contas declarado. A importação foi cancelada.");
  return scope;
}

/** Call after every source row is saved and before publication, under ledger-import-current lock. */
export async function registerLedgerSnapshotScope(client: PoolClient, batchId: string, scope: LedgerSnapshotScope) {
  const newer = await client.query(
    `SELECT 1 FROM ledger_import_scope s JOIN import_batch b ON b.id=s.import_batch_id AND b.status='PUBLICADO'
     WHERE s.source_emitted_at > $1::timestamp
       AND s.period_start <= $3::date AND s.period_end >= $2::date
       AND (s.account_from COLLATE "C") <= ($5::text COLLATE "C") AND (s.account_to COLLATE "C") >= ($4::text COLLATE "C")
       AND s.pa_codes && $6::text[] LIMIT 1`,
    [scope.sourceEmittedAt, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes],
  );
  if (newer.rowCount) throw new Error("Já existe uma versão emitida mais recentemente para este período, contas e PAs. O arquivo antigo não foi publicado.");
  const saved = await client.query<{ count: number; distinct_rows: number; invalid: number }>(
    `SELECT COUNT(*)::int AS count, COUNT(DISTINCT source_row_number)::int AS distinct_rows,
      COUNT(*) FILTER (WHERE posting_date < $2::date OR posting_date > $3::date
        OR (account_code COLLATE "C") < ($4::text COLLATE "C") OR (account_code COLLATE "C") > ($5::text COLLATE "C")
        OR NOT (COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code),'0'),''),'0') = ANY($6::text[]))
        OR superseded_at IS NOT NULL)::int AS invalid
     FROM ledger_entry WHERE source_batch_id=$1`,
    [batchId, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes],
  );
  if (saved.rows[0]?.count !== scope.recordCount || saved.rows[0]?.distinct_rows !== scope.recordCount || saved.rows[0]?.invalid !== 0) throw new Error("A contagem ou o escopo gravado não coincide com o arquivo. A importação foi cancelada.");
  await client.query(
    "INSERT INTO ledger_import_scope(import_batch_id,period_start,period_end,account_from,account_to,pa_codes,record_count,cooperative_code,source_emitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [batchId, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes, scope.recordCount, scope.cooperativeCode, scope.sourceEmittedAt],
  );
}
