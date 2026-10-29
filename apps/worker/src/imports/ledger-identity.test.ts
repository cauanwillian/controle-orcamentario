import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerIdentityKey } from "./ledger-identity.js";

test("PA formatting and surrounding whitespace do not create a second identity", () => {
  const base = ledgerIdentityKey("2026-09-25", "7.1.9.20.16.00.0003-5", "01", "000013", "0000000010");
  assert.equal(base, ledgerIdentityKey("2026-09-25", " 7.1.9.20.16.00.0003-5 ", " 1 ", "000013 ", " 0000000010"));
  assert.equal(base, ledgerIdentityKey("2026-09-25", "\t7.1.9.20.16.00.0003-5\u00a0", "\uFEFF01\r\n", "000013", "0000000010"));
  assert.equal(ledgerIdentityKey("2026-09-25", "8.1", "0", "1", "2"), ledgerIdentityKey("2026-09-25", "8.1", "00", "1", "2"));
  assert.match(base, /^[a-f0-9]{64}$/);
});

test("ambiguous delimiters and control characters are rejected instead of merging entries", () => {
  for (const invalid of ["x|y", "x\ny", "x\ty", " ", "\u0000"]) assert.throws(() => ledgerIdentityKey("2026-09-25", "7.1", "01", invalid, "1"));
});

test("a different journal, account, PA or posting day remains a different entry", () => {
  const tuple: [string, string, string, string, string] = ["2026-09-25", "7.1.9.20.16.00.0003-5", "01", "000013", "0000000010"];
  const baseline = ledgerIdentityKey(...tuple);
  for (const [index, value] of [[0, "2026-09-26"], [1, "7.1.9.20.16.00.0004-3"], [2, "02"], [3, "000014"], [4, "0000000011"]] as const) {
    const changed = [...tuple] as typeof tuple;
    changed[index] = value;
    assert.notEqual(ledgerIdentityKey(...changed), baseline);
  }
});
