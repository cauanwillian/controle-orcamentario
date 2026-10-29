import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(`${repo}/apps/api/package.json`);
require('dotenv').config({path:`${repo}/.env`,quiet:true});
const {Pool}=require('pg');
const ExcelJS=require('exceljs');
const {parseLedgerSnapshotScope,registerLedgerSnapshotScope,looksLikeLedgerEntry}=require(`${repo}/apps/api/dist/ledger-snapshot-scope.js`);
const args=process.argv.slice(2);
const batchId=args[args.indexOf('--batch')+1];
const output=args.includes('--output')?args[args.indexOf('--output')+1]:null;
const apply=args.includes('--apply');
if(!args.includes('--batch')||!/^[-0-9a-f]{36}$/i.test(batchId)||apply===args.includes('--dry-run')) throw new Error('Use --batch UUID e exatamente --dry-run ou --apply.');
const version='011_ledger_snapshot_scopes.sql';
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
  const metadata=await client.query("SELECT b.id,b.checksum_sha256,b.record_count,u.stored_filename FROM import_batch b JOIN ledger_upload u ON u.import_batch_id=b.id WHERE b.id=$1 AND b.source_type='LIVRO_RAZAO' AND b.status='PUBLICADO'",[batchId]);
  const batch=metadata.rows[0];assert.ok(batch,'A importação publicada e seu arquivo original são necessários.');
  const original=await readFile(path.join(repo,'apps/api/data/uploads',path.basename(batch.stored_filename)));
  assert.equal(createHash('sha256').update(original).digest('hex'),batch.checksum_sha256,'O original precisa coincidir com o checksum da importação.');
  const book=new ExcelJS.Workbook();await book.xlsx.load(original);
  const sheet=book.getWorksheet('CTBLivroRazaoAnalitico');assert.ok(sheet);
  const rows=[];let accountCode;
  sheet.eachRow((row,n)=>{
    if(n<=7)return;
    const first=row.getCell(1).value;
    if(first==='CONTA:'){accountCode=row.getCell(2).text.trim();return;}
    if(!(first instanceof Date)){assert.ok(!looksLikeLedgerEntry(row),`Linha ${n}: DATA inválida.`);return;}
    assert.ok(accountCode);
    rows.push({postingDate:first.toISOString().slice(0,10),accountCode,paCode:row.getCell(4).text.trim()});
  });
  const scope=parseLedgerSnapshotScope(sheet,rows);
  assert.equal(scope.recordCount,batch.record_count);
  await client.query('BEGIN');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ledger-import-current'))");
  await client.query('LOCK TABLE ledger_entry IN SHARE ROW EXCLUSIVE MODE');
  await client.query("SET LOCAL statement_timeout='90s'");
  const latest=await client.query("SELECT id FROM import_batch WHERE source_type='LIVRO_RAZAO' AND status='PUBLICADO' ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT 1");
  assert.equal(latest.rows[0]?.id,batchId,'Uma importação posterior exige nova revisão; operação cancelada.');
  const before=await client.query("SELECT COUNT(*)::int AS originals,COUNT(*) FILTER(WHERE superseded_at IS NULL)::int AS non_superseded,(SELECT COUNT(*)::int FROM ledger_entry_current) AS current FROM ledger_entry");
  const outsideBefore=await client.query("SELECT COUNT(*)::int AS rows,SUM(credit_amount-debit_amount)::text AS actual FROM ledger_entry_current WHERE NOT(posting_date BETWEEN $1 AND $2 AND (account_code COLLATE \"C\") BETWEEN ($3::text COLLATE \"C\") AND ($4::text COLLATE \"C\") AND COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code),'0'),''),'0')=ANY($5::text[]))",[scope.periodStart,scope.periodEnd,scope.accountFrom,scope.accountTo,scope.paCodes]);
  const migration=await readFile(path.join(repo,'apps/worker/migrations',version),'utf8');
  const applied=await client.query('SELECT 1 FROM schema_migration WHERE version=$1',[version]);
  if(!applied.rowCount) await client.query(migration);
  const existing=await client.query('SELECT *,period_start::text AS start_iso,period_end::text AS end_iso,source_emitted_at::text AS emitted_iso FROM ledger_import_scope WHERE import_batch_id=$1',[batchId]);
  if(!existing.rowCount) await registerLedgerSnapshotScope(client,batchId,scope);
  else {
    const registered=existing.rows[0];
    assert.equal(registered.record_count,scope.recordCount);
    assert.equal(registered.start_iso,scope.periodStart);assert.equal(registered.end_iso,scope.periodEnd);
    assert.equal(registered.emitted_iso.replace(' ','T'),scope.sourceEmittedAt);
    assert.equal(registered.cooperative_code,scope.cooperativeCode);
    assert.equal(registered.account_from,scope.accountFrom);assert.equal(registered.account_to,scope.accountTo);
    assert.deepEqual(registered.pa_codes,scope.paCodes);
  }
  if(!applied.rowCount)await client.query('INSERT INTO schema_migration(version) VALUES($1)',[version]);
  const state=await client.query("SELECT (SELECT COUNT(*)::int FROM ledger_entry) AS originals,(SELECT COUNT(*)::int FROM ledger_entry_current) AS current,(SELECT COUNT(*)::int FROM ledger_entry_revision) AS revisions");
  assert.equal(state.rows[0].originals,before.rows[0].originals,'Nenhum original pode ser excluído.');
  const outsideAfter=await client.query("SELECT COUNT(*)::int AS rows,SUM(credit_amount-debit_amount)::text AS actual FROM ledger_entry_current WHERE NOT(posting_date BETWEEN $1 AND $2 AND (account_code COLLATE \"C\") BETWEEN ($3::text COLLATE \"C\") AND ($4::text COLLATE \"C\") AND COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code),'0'),''),'0')=ANY($5::text[]))",[scope.periodStart,scope.periodEnd,scope.accountFrom,scope.accountTo,scope.paCodes]);
  assert.deepEqual(outsideAfter.rows,outsideBefore.rows,'Datas, contas e PAs fora do escopo devem permanecer iguais.');
  const inside=await client.query("SELECT COUNT(*)::int AS rows,COUNT(*) FILTER(WHERE source_batch_id=$1)::int AS target_rows FROM ledger_entry_current WHERE posting_date BETWEEN $2 AND $3 AND (account_code COLLATE \"C\") BETWEEN ($4::text COLLATE \"C\") AND ($5::text COLLATE \"C\") AND COALESCE(NULLIF(LTRIM(public.ledger_identity_component(pa_code),'0'),''),'0')=ANY($6::text[])",[batchId,scope.periodStart,scope.periodEnd,scope.accountFrom,scope.accountTo,scope.paCodes]);
  assert.equal(inside.rows[0].rows,scope.recordCount);assert.equal(inside.rows[0].target_rows,scope.recordCount);
  const monthly=await client.query("SELECT date_trunc('month',posting_date)::date::text AS month,COUNT(*)::int AS rows,SUM(credit_amount-debit_amount)::text AS actual FROM ledger_entry_current WHERE posting_date>=date'2026-07-01' GROUP BY 1 ORDER BY 1");
  const checkpoint=await client.query('SELECT generation::text,import_batch_id FROM ledger_import_scope WHERE import_batch_id=$1',[batchId]);
  await client.query(migration);
  const rerun=await client.query('SELECT COUNT(*)::int AS n FROM ledger_entry_current');assert.equal(rerun.rows[0].n,state.rows[0].current);
  const checkpointSql=await readFile(path.join(repo,'scripts/ledger-snapshot-checkpoint.sql'),'utf8');
  const savedState=(await client.query(checkpointSql)).rows[0].state;
  if(args.includes('--verify-rollback')) {
    const reversal=(await readFile(path.join(repo,'scripts/rollback-ledger-snapshot-scopes.sql'),'utf8')).replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
    await client.query("SELECT set_config('app.rollback_011_expected_generation',$1,true),set_config('app.rollback_011_expected_batch_id',$2,true),set_config('app.rollback_011_expected_checkpoint',$3,true)",[checkpoint.rows[0].generation,batchId,JSON.stringify(savedState)]);
    await client.query('SAVEPOINT changed_state_test');
    await client.query("UPDATE import_batch SET original_filename=original_filename||'.test' WHERE id=$1",[batchId]);
    let rejected=false;
    try {await client.query(reversal);}catch(error){rejected=/checkpoint aplicado/.test(error.message);}
    await client.query('ROLLBACK TO SAVEPOINT changed_state_test');
    assert.ok(rejected,'A recuperação precisa recusar alterações posteriores, mesmo sem mudança no timestamp máximo.');
    await client.query('SAVEPOINT reversal_test');
    await client.query(reversal);
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM ledger_entry_current')).rows[0].n,before.rows[0].current);
    await client.query(migration);
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM ledger_entry_current')).rows[0].n,state.rows[0].current);
    await client.query('ROLLBACK TO SAVEPOINT reversal_test');
  }
  const result={capturedAt:new Date().toISOString(),status:apply?'applied':'dry-run-rolled-back',batchId,scope,before:before.rows[0],after:state.rows[0],outsideScopeUnchanged:true,coveredScopeExact:true,migrationRerunIdempotent:true,rollbackAndReapply:args.includes('--verify-rollback')?'PASS':'not-requested',monthly:monthly.rows,recoveryCheckpoint:{...checkpoint.rows[0],state:savedState}};
  await client.query(apply?'COMMIT':'ROLLBACK');
  const filename=output||path.join(repo,'logs',`snapshot-reconciliation-${apply?'applied':'dry-run'}-${batchId}.json`);
  await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(error) {await client.query('ROLLBACK');throw error;}
finally {client.release();await pool.end();}
