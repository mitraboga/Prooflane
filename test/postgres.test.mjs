import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { createStore, postgresOptions } from '../src/store.mjs';
import { startChain } from '../src/chain.mjs';
import { ProoflaneService } from '../src/service.mjs';

test('PostgreSQL: independent services serialize budgets, isolate visitors, rollback and recover evidence', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const databaseUrl=process.env.TEST_DATABASE_URL;
  const schema=`prooflane_test_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool(postgresOptions(databaseUrl));
  const directory=await mkdtemp(join(tmpdir(),'prooflane-pg-'));
  let chain,a,b;
  const poolOptions={options:`-c search_path=${schema}`};
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    chain=await startChain({dataDir:directory,port:0});
    a=new ProoflaneService(chain,directory,{databaseUrl,poolOptions});
    b=new ProoflaneService(chain,directory,{databaseUrl,poolOptions});
    await Promise.all([a.initialize(),b.initialize()]);
    await assert.rejects(a.store.atomic(async()=>{await a.store.run('INSERT INTO app_metadata (key,value) VALUES (?,?)','rollback','test');throw new Error('rollback');}),/rollback/);
    assert.equal(await a.store.get('SELECT value FROM app_metadata WHERE key=?','rollback'),undefined);
    const p=await a.createMandate({label:'PG integration',budget:'50',maxPerReceipt:'40',tools:['text.redact']},'alice');
    const execute=service=>service.execute({mandateId:p.id,tool:'text.redact',input:{text:'Contact test@example.com'},requestId:randomUUID()},'alice');
    const results=await Promise.allSettled([execute(a),execute(b)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUDGET_EXCEEDED');
    const receipt=results.find(r=>r.status==='fulfilled').value;
    await a.anchor({mandateId:p.id},'alice');
    await assert.rejects(b.bundle(receipt.id,'bob'),e=>e.code==='NOT_FOUND');
    const bundle=await b.bundle(receipt.id,'alice');assert.equal((await b.verify(bundle)).valid,true);
    await a.close();a=null;await b.close();b=null;
    a=new ProoflaneService(chain,directory,{databaseUrl,poolOptions});await a.initialize();await a.reconcile();
    assert.equal((await a.state('alice')).metrics.anchored,1);
    assert.equal((await a.state('bob')).metrics.receipts,0);
    const incompatible=new ProoflaneService({...chain,deployment:{...chain.deployment,chainId:'84532'}},directory,{databaseUrl,poolOptions});
    try {await assert.rejects(incompatible.initialize(),/different deployment/);} finally {await incompatible.close();}
  } finally {
    if(a)await a.close();if(b)await b.close();if(chain)await chain.close();
    // Drop only the randomly named schema created by this test, never the database.
    if(!/^prooflane_test_[a-f0-9]{32}$/.test(schema))throw new Error('Invalid test schema');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
    await rm(directory,{recursive:true,force:true});
  }
});
