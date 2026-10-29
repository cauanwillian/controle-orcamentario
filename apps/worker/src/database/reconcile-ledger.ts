import assert from "node:assert/strict";
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { ledgerIdentityKey } from "../imports/ledger-identity.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../../../.env"), quiet: true });
const version = "010_ledger_current_versions.sql";
const apply = process.argv.includes("--apply");
const verifyRollback = process.argv.includes("--verify-rollback");
if (process.argv.slice(2).some(arg => arg !== "--apply" && arg !== "--dry-run" && arg !== "--verify-rollback")) throw new Error("Use --dry-run ou --apply, opcionalmente --verify-rollback.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '90s'");
  const alreadyApplied = await client.query("SELECT 1 FROM schema_migration WHERE version=$1", [version]);
  if (alreadyApplied.rowCount) {
    const state = await client.query("SELECT (SELECT COUNT(*)::int FROM ledger_entry) AS original_rows, (SELECT COUNT(*)::int FROM ledger_entry_current) AS current_rows, (SELECT COUNT(DISTINCT ledger_entry_id)::int FROM ledger_entry_revision WHERE reason='legacy-grouping-duplicate') AS preserved_duplicates");
    console.log(JSON.stringify({ status: "already-applied", ...state.rows[0] }));
    await client.query("ROLLBACK");
  } else {
    const migration = await readFile(path.resolve(currentDir, "../../migrations", version), "utf8");
    const before = await client.query<{ rows: number }>("SELECT COUNT(*)::int AS rows FROM ledger_entry");
    await client.query(migration);
    const state = await client.query("SELECT (SELECT COUNT(*)::int FROM ledger_entry) AS original_rows, (SELECT COUNT(*)::int FROM ledger_entry_current) AS current_rows, (SELECT COUNT(DISTINCT ledger_entry_id)::int FROM ledger_entry_revision WHERE reason='legacy-grouping-duplicate') AS preserved_duplicates");
    assert.equal(state.rows[0].original_rows, before.rows[0].rows, "Nenhum original pode ser excluído.");
    assert.equal(state.rows[0].original_rows - state.rows[0].current_rows, state.rows[0].preserved_duplicates);
    const sample = await client.query("SELECT COUNT(*)::int AS n, SUM(credit_amount-debit_amount)::text AS actual FROM ledger_entry_current WHERE posting_date>=date '2026-09-01' AND posting_date<date '2026-10-01' AND account_code='7.1.9.20.16.00.0003-5' AND COALESCE(NULLIF(LTRIM(BTRIM(pa_code),'0'),''),'0')='1'");
    const monthly = await client.query("SELECT date_trunc('month',posting_date)::date::text AS month, COUNT(*)::int AS rows, SUM(credit_amount-debit_amount)::text AS actual FROM ledger_entry_current WHERE posting_date>=date '2026-08-01' GROUP BY date_trunc('month',posting_date) ORDER BY month");
    let checkedIdentities = 0;
    await client.query("DECLARE ledger_identity_audit NO SCROLL CURSOR FOR SELECT posting_date::text,account_code,pa_code,lot_code,entry_number,source_key FROM ledger_entry_current");
    for (;;) {
      const chunk = await client.query("FETCH FORWARD 5000 FROM ledger_identity_audit");
      if (!chunk.rows.length) break;
      for (const item of chunk.rows) {
        assert.equal(item.source_key, ledgerIdentityKey(item.posting_date, item.account_code, item.pa_code, item.lot_code, item.entry_number), "Identidades SQL/Node divergentes.");
        checkedIdentities += 1;
      }
    }
    await client.query("CLOSE ledger_identity_audit");
    const example = await client.query("SELECT * FROM ledger_entry_current ORDER BY posting_date DESC,id LIMIT 1");
    const unicodeVector = ["2026-09-25", "\t7.1.9.20.16.00.0003-5\u00a0", "\uFEFF01\r\n", "000013", "0000000010"] as const;
    const sqlVector = await client.query<{ key: string }>("SELECT ledger_entry_identity_key($1::date,$2,$3,$4,$5) AS key", [...unicodeVector]);
    assert.equal(sqlVector.rows[0].key, ledgerIdentityKey(...unicodeVector), "SQL e Node devem normalizar espaços Unicode igualmente.");
    await client.query("SAVEPOINT invalid_identifier_test");
    let invalidRejected = false;
    try { await client.query("SELECT ledger_entry_identity_key(date '2026-09-25','7.1|7.2','01','1','2')"); }
    catch (error) { invalidRejected = (error as { code?: string }).code === "22023"; }
    await client.query("ROLLBACK TO SAVEPOINT invalid_identifier_test");
    assert.ok(invalidRejected, "O SQL deve recusar delimitadores ambíguos.");
    if (example.rows[0]) {
      const row = example.rows[0];
      const iso = row.posting_date instanceof Date ? row.posting_date.toISOString().slice(0, 10) : String(row.posting_date).slice(0, 10);
      assert.equal(row.source_key, ledgerIdentityKey(iso, row.account_code, row.pa_code, row.lot_code, row.entry_number), "SQL e Node devem gerar a mesma identidade.");
      await client.query("SAVEPOINT import_test");
      const batch = await client.query<{ id: string }>("INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,reference_date) VALUES('LIVRO_RAZAO','reconciliation-test.xlsx',$1,'PUBLICADO',$2) RETURNING id", ["0".repeat(64), iso]);
      const revisions = await client.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM ledger_entry_revision WHERE ledger_entry_id=$1", [row.id]);
      await client.query("INSERT INTO ledger_entry(source_key,posting_date,account_code,account_name,account_id,pa_code,lot_code,entry_number,grouping_code,history,debit_amount,credit_amount,balance_amount,balance_nature,source_batch_id,source_row_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1) ON CONFLICT(source_key) DO UPDATE SET grouping_code=EXCLUDED.grouping_code,source_batch_id=EXCLUDED.source_batch_id,source_row_number=EXCLUDED.source_row_number,updated_at=NOW()", [row.source_key, iso, row.account_code, row.account_name, row.account_id, row.pa_code, row.lot_code, row.entry_number, "RECONCILIATION-TEST-GROUP", row.history, row.debit_amount, row.credit_amount, row.balance_amount, row.balance_nature, batch.rows[0].id]);
      const testState = await client.query<{ n: number; revisions: number }>("SELECT (SELECT COUNT(*)::int FROM ledger_entry_current WHERE source_key=$1) AS n, (SELECT COUNT(*)::int FROM ledger_entry_revision WHERE ledger_entry_id=$2) AS revisions", [row.source_key,row.id]);
      assert.equal(testState.rows[0].n, 1, "Alterar o agrupador de exportação deve atualizar, sem duplicar.");
      assert.equal(testState.rows[0].revisions, revisions.rows[0].n + 1, "A versão anterior deve permanecer arquivada.");
      await client.query("ROLLBACK TO SAVEPOINT import_test");
    }
    await client.query(migration);
    const repeated = await client.query("SELECT (SELECT COUNT(*)::int FROM ledger_entry_current) AS current_rows, (SELECT COUNT(DISTINCT ledger_entry_id)::int FROM ledger_entry_revision WHERE reason='legacy-grouping-duplicate') AS preserved_duplicates");
    assert.equal(repeated.rows[0].current_rows, state.rows[0].current_rows, "A migração deve ser idempotente.");
    assert.equal(repeated.rows[0].preserved_duplicates, state.rows[0].preserved_duplicates, "Repetir a migração não deve duplicar o arquivo de auditoria.");
    if (verifyRollback) {
      await client.query("SAVEPOINT reversal_test");
      await client.query("INSERT INTO schema_migration(version) VALUES($1)", [version]);
      const rollback = (await readFile(path.resolve(currentDir, "../../../../scripts/rollback-ledger-current-versions.sql"), "utf8")).replace(/^BEGIN;\r?$/m, "").replace(/^COMMIT;\r?$/m, "");
      await client.query(rollback);
      const restored = await client.query("SELECT COUNT(*)::int AS n,COUNT(*) FILTER(WHERE source_key=legacy_source_key)::int AS original_keys FROM ledger_entry_current");
      assert.equal(restored.rows[0].n, before.rows[0].rows, "A reversão deve reativar todos os originais.");
      assert.equal(restored.rows[0].original_keys, before.rows[0].rows, "A reversão deve restaurar as chaves originais.");
      await client.query(migration);
      const reapplied = await client.query("SELECT COUNT(*)::int AS n FROM ledger_entry_current");
      assert.equal(reapplied.rows[0].n, state.rows[0].current_rows, "É possível reaplicar a migração após a reversão.");
      await client.query("ROLLBACK TO SAVEPOINT reversal_test");
    }
    if (apply) {
      await client.query("INSERT INTO schema_migration(version) VALUES($1)", [version]);
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    console.log(JSON.stringify({ status: apply ? "applied" : "dry-run-rolled-back", ...state.rows[0], recovery_sample: sample.rows[0], monthly: monthly.rows, checked_identities: checkedIdentities, identity_and_reimport_tests: "PASS", rollback_and_reapply_test: verifyRollback ? "PASS" : "not-requested" }, null, 2));
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
