import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerIdentityKey } from "./ledger-identity.js";

test("API identity ignores PA padding while preserving the journal identity", () => {
  const key = ledgerIdentityKey("2026-09-25", "7.1.9.20.16.00.0003-5", "01", "000013", "0000000010");
  assert.equal(key, ledgerIdentityKey("2026-09-25", "7.1.9.20.16.00.0003-5", "1", "000013", "0000000010"));
  assert.notEqual(key, ledgerIdentityKey("2026-09-25", "7.1.9.20.16.00.0003-5", "01", "000014", "0000000010"));
  assert.throws(() => ledgerIdentityKey("2026-09-25", "7.1|7.2", "01", "000013", "0000000010"));
});
