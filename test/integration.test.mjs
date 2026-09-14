import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startApplication } from '../src/server.mjs';
import { ProoflaneClient } from '../sdk/client.mjs';
import { actionHash, merkleTree } from '../src/protocol.mjs';
import { HDNodeWallet, keccak256 } from 'ethers';
import { DEV_MNEMONIC } from '../src/chain.mjs';

let app, client, directory;
const policy = overrides => ({label:'Integration test',budget:'100',maxPerReceipt:'40',ttlMinutes:60,tools:['document.digest','text.redact'],...overrides});
const input = {text:'A verifiable report. Contact test@example.com. Changes must be detected.'};
before(async()=>{directory=await mkdtemp(join(tmpdir(),'prooflane-integration-'));app=await startApplication({port:0,chainPort:0,dataDir:directory});client=new ProoflaneClient(app.url);});
after(async()=>{if(app)await app.close();if(directory)await rm(directory,{recursive:true,force:true});});

test('full HTTP → tool → signature → EVM → bundle → independent verification flow',async()=>{
  const p=await client.createMandate(policy());
  const a=await client.execute(p.id,'document.digest',input);
  const b=await client.execute(p.id,'text.redact',input);
  assert.equal(a.nonce,'0');assert.equal(b.nonce,'1');
  assert.equal(b.output.text.includes('test@example.com'),false);
  const batch=await client.anchor(p.id);
  assert.equal(batch.count,2);assert.ok(Number(batch.gas_used)>0);assert.equal(batch.status,'included');
  const bundle=await client.exportReceipt(a.id);
  const result=await client.verify(bundle);
  assert.equal(result.valid,true,JSON.stringify(result.checks));
  assert.equal(result.anchoring,'included_local');assert.equal(result.policyAuthenticity,'checked_onchain');
  const state=await client.state();const stored=state.mandates.find(m=>m.id===p.id);
  assert.equal(stored.spent,'50');assert.equal(stored.reserved,'0');assert.equal(stored.nextNonce,'2');
});

test('tampered content, policy, domain and transaction metadata fail online verification',async()=>{
  const p=await client.createMandate(policy());const r=await client.execute(p.id,'document.digest',input);await client.anchor(p.id);
  const original=await client.exportReceipt(r.id);
  for(const edit of [b=>{b.output.words=999;},b=>{b.policy.budget='999999';},b=>{b.domain.chainId='1';},b=>{b.anchor.transactionHash='0x'+'12'.repeat(32);},b=>{b.anchor.blockNumber+=1;}]){
    const changed=structuredClone(original);edit(changed);assert.equal((await client.verify(changed)).valid,false);
  }
});

test('unanchored evidence cannot be exported as an inclusion proof',async()=>{
  const p=await client.createMandate(policy());const r=await client.execute(p.id,'document.digest',input);
  await assert.rejects(client.exportReceipt(r.id),e=>e.code==='NOT_ANCHORED');
});

test('policy denies an unsupported allowance and per-call overspend before execution',async()=>{
  const p=await client.createMandate(policy({tools:['document.digest'],maxPerReceipt:'10'}));
  await assert.rejects(client.execute(p.id,'text.redact',input),e=>e.code==='TOOL_NOT_ALLOWED');
  await assert.rejects(client.execute(p.id,'document.digest',input),e=>e.code==='PER_CALL_LIMIT');
  assert.equal((await client.state()).receipts.filter(r=>r.mandateId===p.id).length,0);
});

test('simultaneous requests reserve pending budget atomically',async()=>{
  const p=await client.createMandate(policy({budget:'50'}));
  const results=await Promise.allSettled([client.execute(p.id,'text.redact',input),client.execute(p.id,'text.redact',input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUDGET_EXCEEDED');
  assert.equal((await client.state()).mandates.find(m=>m.id===p.id).reserved,'30');
});

test('same request ID is idempotent under concurrency; changed payload conflicts',async()=>{
  const p=await client.createMandate(policy());const key=crypto.randomUUID();
  const results=await Promise.all([client.execute(p.id,'document.digest',input,key),client.execute(p.id,'document.digest',input,key)]);
  assert.equal(results[0].id,results[1].id);assert.equal(results.filter(r=>r.replayed).length,1);
  await assert.rejects(client.execute(p.id,'document.digest',{text:'Different input'},key),e=>e.code==='IDEMPOTENCY_CONFLICT');
  assert.equal((await client.state()).receipts.filter(r=>r.mandateId===p.id).length,1);
});

test('revocation blocks new execution and pending settlement while preserving past evidence',async()=>{
  const p=await client.createMandate(policy());const r=await client.execute(p.id,'document.digest',input);await client.anchor(p.id);
  await client.execute(p.id,'document.digest',input);await client.revoke(p.id);
  await assert.rejects(client.execute(p.id,'document.digest',input),e=>e.code==='INACTIVE_MANDATE');
  await assert.rejects(client.anchor(p.id),e=>e.code==='INACTIVE_MANDATE');
  const result=await client.verify(await client.exportReceipt(r.id));
  assert.equal(result.valid,true);assert.equal(result.currentPolicy.revoked,true);
});

test('HTTP rejects cross-origin mutations, missing client header and malformed input',async()=>{
  const cross=await fetch(`${app.url}/api/mandates`,{method:'POST',headers:{'Origin':'https://attacker.example','Content-Type':'application/json','X-Prooflane-Client':'local-demo'},body:JSON.stringify(policy())});
  assert.equal(cross.status,403);
  const noHeader=await fetch(`${app.url}/api/mandates`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(policy())});assert.equal(noHeader.status,403);
  const broken=await fetch(`${app.url}/api/mandates`,{method:'POST',headers:{'Content-Type':'application/json','X-Prooflane-Client':'local-demo'},body:'{'});assert.equal(broken.status,400);
  await assert.rejects(client.createMandate(policy({budget:'3.5'})),e=>e.status===400);
  await assert.rejects(client.createMandate(policy({tools:['document.digest','document.digest']})),e=>e.status===400);
});

test('web entrypoint, script and stylesheet are served with browser security headers',async()=>{
  for(const path of ['/','/app.js','/styles.css']){const response=await fetch(app.url+path);assert.equal(response.status,200);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok((await response.text()).length>100);}
});

test('restart recovers a mined batch even when local indexing never ran',async()=>{
  const p=await client.createMandate(policy());const r=await client.execute(p.id,'document.digest',input);
  const tree=merkleTree(p.tools.map(actionHash));
  const tx=await app.service.contract.settleBatch(p.id,[r.receipt],[r.signature],[tree.proofs[p.tools.indexOf(r.tool)]]);await tx.wait();
  await app.chain.snapshot();
  assert.equal(app.service.db.prepare('SELECT status FROM receipts WHERE id=?').get(r.id).status,'pending');
  const address=app.chain.deployment.address;
  await app.close();app=null;
  app=await startApplication({port:0,chainPort:0,dataDir:directory});client=new ProoflaneClient(app.url);
  assert.equal(app.chain.deployment.address,address);
  const bundle=await client.exportReceipt(r.id);
  assert.equal((await client.verify(bundle)).valid,true);
  assert.equal((await client.state()).mandates.find(m=>m.id===p.id).spent,'20');
});

test('visitor scopes isolate reads, writes, evidence exports and idempotency keys',async()=>{
  const a='visitor-a',b='visitor-b',service=app.service;
  const pa=await service.createMandate(policy(),a),pb=await service.createMandate(policy(),b);
  const requestId='shared-request-id';
  const ra=await service.execute({mandateId:pa.id,tool:'document.digest',input,requestId},a);
  const rb=await service.execute({mandateId:pb.id,tool:'document.digest',input,requestId},b);
  assert.notEqual(ra.id,rb.id);
  await assert.rejects(service.execute({mandateId:pa.id,tool:'document.digest',input,requestId:'another-request-id'},b),e=>e.code==='NOT_FOUND');
  await assert.rejects(service.anchor({mandateId:pa.id},b),e=>e.code==='NOT_FOUND');
  await assert.rejects(service.revoke({mandateId:pa.id},b),e=>e.code==='NOT_FOUND');
  await service.anchor({mandateId:pa.id},a);
  await assert.rejects(service.bundle(ra.id,b),e=>e.code==='NOT_FOUND');
  assert.equal((await service.state(b)).receipts.some(r=>r.id===ra.id),false);
  assert.equal((await service.verify(await service.bundle(ra.id,a))).valid,true);
});

test('a lost broadcast response recovers committed signed bytes without a duplicate transaction',async()=>{
  const service=app.service,chain=app.chain;
  const p=await service.createMandate(policy());
  const r=await service.execute({mandateId:p.id,tool:'document.digest',input,requestId:crypto.randomUUID()});
  const wallet=HDNodeWallet.fromPhrase(DEV_MNEMONIC).connect(chain.provider);
  let broadcasts=0;
  chain.sendTransaction=async(method,args,save)=>{
    const call=await chain.contract.getFunction(method).populateTransaction(...args);
    const rawTransaction=await wallet.signTransaction(await wallet.populateTransaction(call));
    const hash=keccak256(rawTransaction);
    await save({hash,rawTransaction});
    assert.equal((await service.store.get('SELECT raw_transaction FROM operations WHERE tx_hash=?',hash)).raw_transaction,rawTransaction);
    const tx=await chain.provider.broadcastTransaction(rawTransaction);broadcasts++;await tx.wait();
    throw new Error('Simulated lost HTTP response after mining');
  };
  try {
    await assert.rejects(service.anchor({mandateId:p.id}),e=>e.code==='TRANSACTION_PENDING');
    await service.reconcile();
    assert.equal(broadcasts,1);
    const bundle=await service.bundle(r.id);assert.equal((await service.verify(bundle)).valid,true);
    assert.equal((await service.policy(p.id)).spent,'20');
    assert.equal((await service.store.get('SELECT raw_transaction FROM operations WHERE tx_hash=?',bundle.anchor.transactionHash)).raw_transaction,null);
  } finally { delete chain.sendTransaction; }
});

test('persistent daily quotas count failed attempts and survive service restarts',async()=>{
  const service=app.service;
  service.publicMode=true;const previous=service.limits.executions;service.limits.executions=[1,1000];
  try {
    const p=await service.createMandate(policy({tools:['document.digest']}),'quota-test');
    await assert.rejects(service.execute({mandateId:p.id,tool:'text.redact',input,requestId:crypto.randomUUID()},'quota-test'),e=>e.code==='TOOL_NOT_ALLOWED');
    await assert.rejects(service.execute({mandateId:p.id,tool:'document.digest',input,requestId:crypto.randomUUID()},'quota-test'),e=>e.code==='DEMO_QUOTA');
    assert.equal(Number((await service.store.get("SELECT count FROM usage_counters WHERE subject=? AND category='executions'",'quota-test')).count),1);
  } finally {service.publicMode=false;service.limits.executions=previous;}
  await app.close();app=await startApplication({port:0,chainPort:0,dataDir:directory});client=new ProoflaneClient(app.url);
  assert.equal(Number((await app.service.store.get("SELECT count FROM usage_counters WHERE subject=? AND category='executions'",'quota-test')).count),1);
});
