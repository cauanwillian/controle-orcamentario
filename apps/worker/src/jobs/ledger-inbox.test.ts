import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ledgerImport from "@orcamento/shared/ledger-import";
import { findPublishedLedgerBatch, LedgerImportValidationError, recordRejectedBatch } from "../imports/import-ledger.js";
import { isStableInboxFile, runLedgerInbox } from "./ledger-inbox.js";

const noWait = async () => undefined;
const fixedNow = () => Date.parse("2026-11-04T18:00:00.000Z");

async function inbox(t: { after(callback: () => void | Promise<void>): void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ledger-inbox-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function makeOld(filePath: string) {
  await writeFile(filePath, "xlsx-test");
  const old = new Date(fixedNow() - 30_000);
  await utimes(filePath, old, old);
}

test("inbox ignores hidden, Excel temporary, and non-xlsx entries", async (t) => {
  const directory = await inbox(t);
  await makeOld(path.join(directory, "ledger.xlsx"));
  await makeOld(path.join(directory, "~$ledger.xlsx"));
  await makeOld(path.join(directory, "other.tmp"));
  await makeOld(path.join(directory, ".hidden.xlsx"));
  await makeOld(path.join(directory, "notes.txt"));
  const seen: string[] = [];
  await runLedgerInbox({ inboxDirectory: directory, minAgeMs: 0, stabilityWaitMs: 0, now: fixedNow, wait: noWait,
    checksum: async () => "a".repeat(64),
    importFile: async (_file, _source, _checksum, original) => { seen.push(original); return { checksum: "a".repeat(64), batchId: "batch-1" }; },
  });
  assert.deepEqual(seen, ["ledger.xlsx"]);
});

test("inbox leaves young and changing files untouched for the next scan", async (t) => {
  const directory = await inbox(t);
  const file = path.join(directory, "copying.xlsx");
  await makeOld(file);
  const ageResult = await isStableInboxFile(file, { minAgeMs: 60_000, stabilityWaitMs: 0, now: fixedNow, wait: noWait });
  assert.equal(ageResult, false);
  const lockedResult = await isStableInboxFile(file, {
    minAgeMs: 0, stabilityWaitMs: 0, now: fixedNow, wait: noWait,
    openForRead: async () => { throw Object.assign(new Error("locked"), { code: "EBUSY" }); },
  });
  assert.equal(lockedResult, false);
  let reads = 0;
  const changingResult = await isStableInboxFile(file, {
    minAgeMs: 0, stabilityWaitMs: 1, now: fixedNow, wait: noWait,
    getStat: async () => ({ size: ++reads === 1 ? 10 : 11, mtimeMs: 100 }), openForRead: noWait,
  });
  assert.equal(changingResult, false);
  let imports = 0;
  const result = await runLedgerInbox({
    inboxDirectory: directory, minAgeMs: 0, stabilityWaitMs: 0, now: fixedNow, wait: noWait,
    getStat: async () => ({ size: 10, mtimeMs: fixedNow() }), openForRead: noWait,
    checksum: async () => "b".repeat(64), importFile: async () => { imports += 1; return { checksum: "b".repeat(64) }; },
  });
  assert.equal(imports, 1);
  assert.equal(result[0].status, "IMPORTED");
});

test("published checksum duplicates are archived without creating another import", async (t) => {
  const directory = await inbox(t);
  await makeOld(path.join(directory, "ledger.xlsx"));
  const checksum = "c".repeat(64);
  const result = await runLedgerInbox({
    inboxDirectory: directory, minAgeMs: 0, stabilityWaitMs: 0, now: fixedNow, wait: noWait,
    checksum: async () => checksum,
    importFile: async (_file, _source, inputChecksum) => ({ skippedDuplicate: true, existingBatchId: "published-1", checksum: inputChecksum }),
  });
  assert.equal(result[0].status, "SKIPPED_DUPLICATE");
  assert.equal(result[0].existingBatchId, "published-1");
  assert.match((await readdir(path.join(directory, "processados")))[0], /^2026-11-04 - c{8} - ledger\.xlsx$/);
  assert.equal((await readdir(directory)).includes("ledger.xlsx"), false);
});

test("automatic duplicate lookup only matches a published ledger batch", async () => {
  let statement = "";
  const checksum = "f".repeat(64);
  const batchId = await findPublishedLedgerBatch({
    query: async (sql: string, values?: unknown[]) => {
      statement = sql;
      assert.deepEqual(values, [checksum]);
      return { rows: [{ id: "published-ledger-batch" }], rowCount: 1 };
    },
  } as never, checksum);
  assert.equal(batchId, "published-ledger-batch");
  assert.match(statement, /source_type='LIVRO_RAZAO'.*checksum_sha256=\$1.*status='PUBLICADO'/s);
});

test("rejected imports persist the audit batch in its own committed transaction", async () => {
  const statements: { sql: string; values?: unknown[] }[] = [];
  let released = false;
  const fakePool = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => { statements.push({ sql, values }); return { rows: [], rowCount: 1 }; },
      release: () => { released = true; },
    }),
  };
  await recordRejectedBatch(fakePool as never, "bad.xlsx", "a".repeat(64), "invalid header");
  assert.deepEqual(statements.map(({ sql }) => sql), [
    "BEGIN",
    "INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,error_summary,completed_at) VALUES('LIVRO_RAZAO',$1,$2,'REJEITADO',$3,NOW())",
    "COMMIT",
  ]);
  assert.deepEqual(statements[1].values, ["bad.xlsx", "a".repeat(64), "invalid header"]);
  assert.equal(released, true);
});

test("success archives the file and validation failure writes a sidecar and alerts", async (t) => {
  const directory = await inbox(t);
  await makeOld(path.join(directory, "valid.xlsx"));
  await makeOld(path.join(directory, "invalid.xlsx"));
  const checksum = "d".repeat(64);
  const alerts: string[] = [];
  const results = await runLedgerInbox({
    inboxDirectory: directory, minAgeMs: 0, stabilityWaitMs: 0, now: fixedNow, wait: noWait,
    checksum: async (filePath) => path.basename(filePath).includes("invalid") ? "e".repeat(64) : checksum,
    importFile: async (_file, _source, fileChecksum) => {
      if (fileChecksum === "e".repeat(64)) throw new LedgerImportValidationError("Cabeçalho inválido");
      return { checksum: fileChecksum, batchId: "new-batch", unmappedAccountCount: 2 };
    },
    alert: async (name, reason) => { alerts.push(`${name}: ${reason}`); return true; },
  });
  assert.deepEqual(results.map((result) => result.status).sort(), ["IMPORTED", "REJECTED"]);
  assert.deepEqual(alerts, ["invalid.xlsx: Cabeçalho inválido"]);
  const processedName = (await readdir(path.join(directory, "processados")))[0];
  assert.match(processedName, /^2026-11-04 - d{8} - valid\.xlsx$/);
  const rejectedName = (await readdir(path.join(directory, "rejeitados"))).find((name) => name.endsWith(".xlsx"))!;
  assert.match(rejectedName, /^2026-11-04 - e{8} - invalid\.xlsx$/);
  assert.equal(await readFile(path.join(directory, "rejeitados", `${rejectedName}.erro.txt`), "utf8"), "Cabeçalho inválido\n");
});

test("shared parser helpers accept formula results and rich text cells", () => {
  assert.equal(ledgerImport.cellText({ richText: [{ text: "Conta " }, { text: "A" }] }), "Conta A");
  assert.equal(ledgerImport.cellText({ formula: "A1", result: " 00012 " }), "00012");
  assert.equal(ledgerImport.numeric({ formula: "A1+B1", result: 12.5 }, 1, "valor"), 12.5);
  assert.equal(ledgerImport.numeric({ formula: "A1+B1", result: "1.234,50" }, 1, "valor"), 1234.5);
  assert.equal(ledgerImport.postingDate({ formula: "A1", result: "04/11/2026" }, 1), "2026-11-04");
});
