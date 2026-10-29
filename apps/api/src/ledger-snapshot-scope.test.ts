import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { ledgerScopeContains, looksLikeLedgerEntry, parseLedgerSnapshotScope } from "./ledger-snapshot-scope.js";

const account = "7.1.1.03.00.00.0001-5";
const entry = { postingDate: "2026-09-30", accountCode: account, paCode: "01" };
function sheet() {
  const sheet = new ExcelJS.Workbook().addWorksheet("CTBLivroRazaoAnalitico");
  for (const [address, value] of Object.entries({ A4: "4598 - SICOOB NORTE MT", I2: "28/10/2026", I4: "09:34:52", A5: "Período:", B5: "01/07/2026 a 28/10/2026", E5: "Contas:", F5: `${account} a 8.9.4.20.10.00.0001-3`, A6: "Forma de Pesquisa:", B6: "Conta Contábil", E6: "Totalizar Por:", F6: "-" })) sheet.getCell(address).value = value;
  return sheet;
}

test("snapshot uses declared coverage, including days with no postings, and normalizes only observed PAs", () => {
  const scope = parseLedgerSnapshotScope(sheet(), [entry, { ...entry, paCode: "1" }, { ...entry, paCode: "000" }]);
  assert.equal(scope.periodStart, "2026-07-01");
  assert.equal(scope.periodEnd, "2026-10-28");
  assert.equal(scope.sourceEmittedAt, "2026-10-28T09:34:52");
  assert.deepEqual(scope.paCodes, ["0", "1"]);
  assert.ok(ledgerScopeContains(scope, { ...entry, postingDate: "2026-10-28" }));
  assert.equal(ledgerScopeContains(scope, { ...entry, paCode: "02" }), false);
  assert.equal(ledgerScopeContains(scope, { ...entry, postingDate: "2026-06-30" }), false);
  assert.equal(ledgerScopeContains(scope, { ...entry, accountCode: "9.1.1.03.00.00.0001-5" }), false);
});

test("partial or invalid headers and rows outside declared coverage fail before publication", () => {
  for (const [address, value] of Object.entries({ B5: "31/02/2026 a 28/10/2026", F5: "7.1.1.3 a 8.9.4.20.10.00.0001-3", A4: "9999 - OUTRA COOPERATIVA", I4: "25:30:00", F6: "PA" })) {
    const changed = sheet(); changed.getCell(address).value = value;
    assert.throws(() => parseLedgerSnapshotScope(changed, [entry]));
  }
  assert.throws(() => parseLedgerSnapshotScope(sheet(), [{ ...entry, postingDate: "2026-06-30" }]), /fora do período/);
  assert.throws(() => parseLedgerSnapshotScope(sheet(), [{ ...entry, paCode: "1|2" }]), /PA inválida/);
  assert.throws(() => parseLedgerSnapshotScope(sheet(), []), /vazio/);
});

test("a malformed posting date cannot silently drop an entry, including one with zero value", () => {
  const source = sheet();
  source.getRow(8).values = ["data incorreta", "000087", "0000005302", "01", "", "", 0, 0];
  assert.equal(looksLikeLedgerEntry(source.getRow(8)), true);
  source.getRow(9).values = ["", "CONTA:", account, "Nome da conta", "", "TOTAL DA CONTA:", 100, 100];
  assert.equal(looksLikeLedgerEntry(source.getRow(9)), false);
});
