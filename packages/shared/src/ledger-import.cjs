const { createHash } = require("node:crypto");

const accountPattern = /^[0-9]\.[0-9]\.[0-9]\.[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}-[0-9]$/;

function resolvedCellValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    if ("result" in value) return value.result;
    if ("text" in value) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  }
  return value;
}

function cellText(value) {
  const resolved = resolvedCellValue(value);
  if (resolved === null || resolved === undefined) return null;
  return String(resolved).trim() || null;
}

function numeric(value, rowNumber, label, nullable = false) {
  const resolved = resolvedCellValue(value);
  if (typeof resolved === "number") return resolved;
  if (resolved === null || resolved === undefined || String(resolved).trim() === "-") return nullable ? null : 0;
  const raw = String(resolved).trim();
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  if (!Number.isFinite(parsed)) throw new Error(`Linha ${rowNumber}: ${label} não possui valor numérico.`);
  return parsed;
}

function postingDate(value, rowNumber) {
  const resolved = resolvedCellValue(value);
  if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) return resolved.toISOString().slice(0, 10);
  const raw = String(resolved ?? "").trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})$/)?.[1]
    ?? raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)?.slice(1).reverse().join("-");
  if (iso) {
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) return iso;
  }
  throw new Error(`Linha ${rowNumber}: DATA inválida.`);
}

function ledgerIdentityKey(date, account, pa, lot, entry) {
  const parts = [date, account, pa, lot, entry].map((value) => String(value).trim());
  if (parts.some((value) => !value || /[\u0000-\u001f\u007f|]/.test(value))) throw new Error("Identificador contábil vazio ou com caracteres inválidos.");
  const [posting, accountCode, rawPa, lotCode, entryNumber] = parts;
  const normalizedPa = /^\d+$/.test(rawPa) ? rawPa.replace(/^0+(?=\d)/, "") : rawPa;
  return createHash("sha256").update(["ledger:v2", posting, accountCode, normalizedPa, lotCode, entryNumber].join("|")).digest("hex");
}

function looksLikeLedgerEntry(row) {
  return [2, 3, 4].every((column) => /^[0-9]+$/.test(row.getCell(column).text.trim()));
}

function normalizeSnapshotPa(value) {
  const code = value.trim();
  if (!/^[0-9]+$/.test(code)) throw new Error("O escopo do Livro Razão contém PA inválida.");
  return code.replace(/^0+(?=\d)/, "");
}

function sourceDate(value) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!iso || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error("Período inválido no cabeçalho do Livro Razão.");
  return iso;
}

function ledgerScopeContains(scope, row) {
  return row.postingDate >= scope.periodStart && row.postingDate <= scope.periodEnd
    && accountPattern.test(row.accountCode) && row.accountCode >= scope.accountFrom && row.accountCode <= scope.accountTo
    && scope.paCodes.includes(normalizeSnapshotPa(row.paCode));
}

function parseLedgerSnapshotScope(sheet, rows) {
  const value = (row, column) => cellText(sheet.getRow(row).getCell(column).value) ?? "";
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
  const scope = {
    periodStart: sourceDate(period[1]), periodEnd: sourceDate(period[2]), accountFrom: accounts[1], accountTo: accounts[2],
    paCodes: [...new Set(rows.map((row) => normalizeSnapshotPa(row.paCode)))].sort((a, b) => Number(a) - Number(b)), recordCount: rows.length,
    cooperativeCode, sourceEmittedAt: `${sourceDate(emissionDate)}T${emissionTime}`,
  };
  if (!scope.recordCount || scope.periodStart > scope.periodEnd || scope.accountFrom > scope.accountTo) throw new Error("Escopo vazio ou invertido no Livro Razão.");
  if (rows.some((row) => !ledgerScopeContains(scope, row))) throw new Error("Há lançamentos fora do período ou intervalo de contas declarado. A importação foi cancelada.");
  return scope;
}

function parseLedgerWorkbook(workbook) {
  const sheet = workbook.getWorksheet("CTBLivroRazaoAnalitico");
  if (!sheet) throw new Error("A aba CTBLivroRazaoAnalitico não foi encontrada.");
  if (cellText(sheet.getRow(7).getCell(1).value)?.toUpperCase() !== "DATA") throw new Error("Cabeçalho DATA não encontrado na linha 7.");
  let accountCode = null, accountName = null, skippedRows = 0;
  const rows = [], sourceKeys = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 7) return;
    const firstValue = resolvedCellValue(row.getCell(1).value);
    if (firstValue === "CONTA:") {
      accountCode = cellText(row.getCell(2).value);
      accountName = cellText(row.getCell(3).value);
      if (!accountCode) throw new Error(`Linha ${rowNumber}: cabeçalho de conta sem código.`);
      return;
    }
    const isDate = firstValue instanceof Date || typeof firstValue === "string" && (/^\d{4}-\d{2}-\d{2}$/.test(firstValue.trim()) || /^\d{2}\/\d{2}\/\d{4}$/.test(firstValue.trim()));
    if (!isDate) {
      if (looksLikeLedgerEntry(row)) throw new Error(`Linha ${rowNumber}: DATA ausente ou inválida em um lançamento.`);
      skippedRows += 1;
      return;
    }
    if (!accountCode) throw new Error(`Linha ${rowNumber}: lançamento sem conta contábil anterior.`);
    const date = postingDate(firstValue, rowNumber), lotCode = cellText(row.getCell(2).value), entryNumber = cellText(row.getCell(3).value), paCode = cellText(row.getCell(4).value);
    if (!lotCode || !entryNumber || !paCode) throw new Error(`Linha ${rowNumber}: lote, lançamento ou PA não informado.`);
    const sourceKey = ledgerIdentityKey(date, accountCode, paCode, lotCode, entryNumber);
    if (sourceKeys.has(sourceKey)) throw new Error(`Linha ${rowNumber}: lançamento duplicado no próprio arquivo.`);
    sourceKeys.add(sourceKey);
    rows.push({ sourceKey, rowNumber, postingDate: date, accountCode, accountName, paCode, lotCode, entryNumber,
      groupingCode: cellText(row.getCell(5).value), history: cellText(row.getCell(6).value),
      debitAmount: numeric(row.getCell(7).value, rowNumber, "VALOR A DÉBITO") ?? 0,
      creditAmount: numeric(row.getCell(8).value, rowNumber, "VALOR A CRÉDITO") ?? 0,
      balanceAmount: numeric(row.getCell(9).value, rowNumber, "SALDO", true), balanceNature: cellText(row.getCell(11).value) });
  });
  if (!rows.length) throw new Error("Nenhum lançamento contábil foi identificado no arquivo.");
  return { rows, skippedRows, scope: parseLedgerSnapshotScope(sheet, rows) };
}

async function registerLedgerSnapshotScope(client, batchId, scope) {
  const newer = await client.query(
    `SELECT 1 FROM ledger_import_scope s JOIN import_batch b ON b.id=s.import_batch_id AND b.status='PUBLICADO'
     WHERE s.source_emitted_at > $1::timestamp
       AND s.period_start <= $3::date AND s.period_end >= $2::date
       AND (s.account_from COLLATE "C") <= ($5::text COLLATE "C") AND (s.account_to COLLATE "C") >= ($4::text COLLATE "C")
       AND s.pa_codes && $6::text[] LIMIT 1`,
    [scope.sourceEmittedAt, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes],
  );
  if (newer.rowCount) throw new Error("Já existe uma versão emitida mais recentemente para este período, contas e PAs. O arquivo antigo não foi publicado.");
  const saved = await client.query(
    `SELECT COUNT(*)::int AS count, COUNT(DISTINCT source_row_number)::int AS distinct_rows,
      COUNT(*) FILTER (WHERE posting_date < $2::date OR posting_date > $3::date
        OR (account_code COLLATE "C") < ($4::text COLLATE "C") OR (account_code COLLATE "C") > ($5::text COLLATE "C")
        OR NOT (COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code),'0'),''),'0') = ANY($6::text[]))
        OR superseded_at IS NOT NULL)::int AS invalid
     FROM ledger_entry WHERE source_batch_id=$1`,
    [batchId, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes],
  );
  if (saved.rows[0]?.count !== scope.recordCount || saved.rows[0]?.distinct_rows !== scope.recordCount || saved.rows[0]?.invalid !== 0) throw new Error("A contagem ou o escopo gravado não coincide com o arquivo. A importação foi cancelada.");
  await client.query("INSERT INTO ledger_import_scope(import_batch_id,period_start,period_end,account_from,account_to,pa_codes,record_count,cooperative_code,source_emitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [batchId, scope.periodStart, scope.periodEnd, scope.accountFrom, scope.accountTo, scope.paCodes, scope.recordCount, scope.cooperativeCode, scope.sourceEmittedAt]);
}

async function insertLedgerEntries(client, rows, accountIds, batchId, batchSize = 400) {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const group = rows.slice(offset, offset + batchSize), values = [];
    const placeholders = group.map((row, index) => {
      const base = index * 16;
      values.push(row.sourceKey, row.postingDate, row.accountCode, row.accountName, accountIds.get(row.accountCode) ?? null, row.paCode, row.lotCode, row.entryNumber, row.groupingCode, row.history, row.debitAmount, row.creditAmount, row.balanceAmount, row.balanceNature, batchId, row.rowNumber);
      return `(${Array.from({ length: 16 }, (_, i) => `$${base + i + 1}`).join(",")})`;
    });
    await client.query(
      `INSERT INTO ledger_entry (source_key, posting_date, account_code, account_name, account_id, pa_code, lot_code, entry_number, grouping_code, history, debit_amount, credit_amount, balance_amount, balance_nature, source_batch_id, source_row_number) VALUES ${placeholders.join(",")}
       ON CONFLICT (source_key) DO UPDATE SET account_name=EXCLUDED.account_name, account_id=EXCLUDED.account_id, grouping_code=EXCLUDED.grouping_code, history=EXCLUDED.history, debit_amount=EXCLUDED.debit_amount, credit_amount=EXCLUDED.credit_amount, balance_amount=EXCLUDED.balance_amount, balance_nature=EXCLUDED.balance_nature, source_batch_id=EXCLUDED.source_batch_id, source_row_number=EXCLUDED.source_row_number, updated_at=NOW()`,
      values,
    );
  }
}

module.exports = { cellText, numeric, postingDate, ledgerIdentityKey, looksLikeLedgerEntry, normalizeSnapshotPa, ledgerScopeContains,
  parseLedgerSnapshotScope, parseLedgerWorkbook, registerLedgerSnapshotScope, insertLedgerEntries };
