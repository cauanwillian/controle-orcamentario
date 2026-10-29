import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(`${root}/apps/api/package.json`);
require('dotenv').config({path:`${root}/.env`,quiet:true});
const {Pool}=require('pg');
const {ledgerIdentityKey}=require(`${root}/apps/api/dist/ledger-identity.js`);
const {registerLedgerSnapshotScope}=require(`${root}/apps/api/dist/ledger-snapshot-scope.js`);
const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(`${root}/apps/worker/migrations/011_ledger_snapshot_scopes.sql`,'utf8'));
  const countBefore=await client.query('SELECT COUNT(*)::int AS n FROM ledger_entry');
  const batch=async()=>{
    const result=await client.query("INSERT INTO import_batch(source_type,original_filename,checksum_sha256,status,reference_date) VALUES('LIVRO_RAZAO','snapshot-integration-test.xlsx',$1,'PROCESSANDO','2090-09-30') RETURNING id",[createHash('sha256').update(randomUUID()).digest('hex')]);return result.rows[0].id;
  };
  const a='9.1.1.03.00.00.0001-5',b='9.1.1.03.00.00.0002-5',c='9.1.1.03.00.00.0003-5';
  const lot=`TEST-${randomUUID()}`;
  const old=await batch(),fresh=await batch();
  const row=async(owner,date,account,pa,entry,amount,sourceRow)=>{
    await client.query('INSERT INTO ledger_entry(source_key,posting_date,account_code,pa_code,lot_code,entry_number,history,debit_amount,credit_amount,source_batch_id,source_row_number) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10)',[ledgerIdentityKey(date,account,pa,lot,entry),date,account,pa,lot,entry,'MESMO HISTÓRICO',amount,owner,sourceRow]);
  };
  await row(old,'2090-09-15',a,'01','1',10,1);
  await row(old,'2090-09-15',a,'02','2',20,2);
  await row(old,'2090-08-30',a,'01','3',30,3);
  await row(old,'2090-09-15',c,'01','4',40,4);
  await row(old,'2090-09-16',b,'01','5',50,5);
  await client.query("UPDATE import_batch SET status='PUBLICADO',record_count=5,completed_at=NOW() WHERE id=$1",[old]);
  // Identical legitimate entries inside one source must both remain visible.
  await row(fresh,'2090-09-15',a,'01','6',11,1);
  await row(fresh,'2090-09-15',a,'01','7',11,2);
  const scope={periodStart:'2090-09-01',periodEnd:'2090-09-30',accountFrom:a,accountTo:b,paCodes:['1'],recordCount:2,cooperativeCode:'4598',sourceEmittedAt:'2090-10-01T10:00:00'};
  await registerLedgerSnapshotScope(client,fresh,scope);
  await client.query("UPDATE import_batch SET status='PUBLICADO',record_count=2,completed_at=NOW() WHERE id=$1",[fresh]);
  const visible=await client.query('SELECT pa_code,entry_number,credit_amount::text FROM ledger_entry_current WHERE lot_code=$1 ORDER BY entry_number',[lot]);
  assert.deepEqual(visible.rows.map(r=>r.entry_number),['2','3','4','6','7']);
  const repeat=await batch();
  await client.query('UPDATE ledger_entry SET source_batch_id=$1 WHERE source_batch_id=$2',[repeat,fresh]);
  await registerLedgerSnapshotScope(client,repeat,{...scope,sourceEmittedAt:'2090-10-01T10:01:00'});
  await client.query("UPDATE import_batch SET status='PUBLICADO',record_count=2,completed_at=NOW() WHERE id=$1",[repeat]);
  const repeated=await client.query('SELECT entry_number FROM ledger_entry_current WHERE lot_code=$1 ORDER BY entry_number',[lot]);
  assert.deepEqual(repeated.rows.map(r=>r.entry_number),['2','3','4','6','7']);
  const stale=await batch();
  await assert.rejects(registerLedgerSnapshotScope(client,stale,{...scope,sourceEmittedAt:'2090-09-30T00:00:00'}),/mais recentemente/);
  const incomplete=await batch();
  await assert.rejects(registerLedgerSnapshotScope(client,incomplete,{...scope,sourceEmittedAt:'2090-10-02T00:00:00'}),/contagem ou o escopo/);
  const raw=await client.query('SELECT COUNT(*)::int AS n FROM ledger_entry');assert.equal(raw.rows[0].n,countBefore.rows[0].n+7);
  console.log(JSON.stringify({status:'PASS',rolledBack:true,checks:['renumbered and corrected entries supersede the earlier source','absent account inside declared range is zero in the newer source','absent PA remains visible','outside date and account remain visible','identical legitimate entries inside the same source remain distinct','reimport has no duplicated totals','stale source and incomplete saved source are rejected','all original rows remain preserved']},null,2));
} finally {await client.query('ROLLBACK');client.release();await pool.end();}
