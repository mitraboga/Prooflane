import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createSession, readSession, RequestLimiter } from '../src/session.mjs';
import { readConfig } from '../src/config.mjs';
import { publicWallet, validatePublicDeployment, confirmedReceipt } from '../src/chain.mjs';
import { createHttpServer } from '../src/server.mjs';
import { postgresOptions } from '../src/store.mjs';

const secret = 'test-only-session-secret-'.repeat(3);
test('guest sessions reject forged, expired, duplicate and differently signed cookies', () => {
  const now = Date.now(), session = createSession(secret, now);
  assert.equal(readSession(session.cookie, secret, now), session.scope);
  assert.equal(readSession(session.cookie, 'another-secret', now), null);
  assert.equal(readSession(session.cookie.replace(session.scope, 'a'.repeat(43)), secret, now), null);
  assert.equal(readSession(`${session.cookie}; ${session.cookie}`, secret, now), null);
  assert.equal(readSession(session.cookie, secret, now + 31 * 86400000), null);
  assert.match(session.cookie, /HttpOnly; Secure; SameSite=Lax/);
});

test('request limits cap a visitor and all visitors together, then reset', () => {
  const limiter = new RequestLimiter({perSession:2,global:3});
  assert.equal(limiter.allow('a',1000),true); assert.equal(limiter.allow('a',1000),true);
  assert.equal(limiter.allow('a',1000),false); assert.equal(limiter.allow('b',1000),false);
  assert.equal(limiter.allow('a',61000),true);
});

test('public startup requires durable storage, secure origin and a session secret', () => {
  const config = {mode:'base-sepolia',publicOrigin:'https://prooflane.example',databaseUrl:'postgres://test:test@localhost/test',sessionSecret:secret};
  assert.equal(readConfig(config,{}).host,'0.0.0.0');
  assert.equal(readConfig(config,{}).confirmations,3);
  assert.equal(readConfig({...config,sessionSecret:Buffer.alloc(32,7).toString('base64')},{}).publicMode,true);
  for (const override of [{databaseUrl:''},{publicOrigin:'http://prooflane.example'},{publicOrigin:'https://prooflane.example/path'},{sessionSecret:'short'},{sessionSecret:'x'.repeat(42)},{confirmations:0}]) assert.throws(()=>readConfig({...config,...override},{}));
  assert.equal(readConfig({},{}).mode,'local');
});

test('remote PostgreSQL verifies TLS even when the URL tries to disable it', () => {
  const options = postgresOptions('postgresql://user:password@example.neon.tech/neondb?sslmode=disable');
  assert.equal(options.ssl.rejectUnauthorized,true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'),false);
  assert.equal(postgresOptions('postgres://user:password@localhost/test').ssl,false);
});

test('public keys reject known development accounts without echoing private material', () => {
  assert.throws(()=>publicWallet('0x'+'0'.repeat(63)+'1'),/development key/);
  const invalid='secret-not-a-valid-key';
  assert.throws(()=>publicWallet(invalid),error=>!error.message.includes(invalid));
});

test('deployment validation rejects a different network, runtime or creation block', async () => {
  const address='0x'+'12'.repeat(20), artifact={deployedBytecode:'0x6000'};
  const provider={getNetwork:async()=>({chainId:84532n}),getBlockNumber:async()=>100,getCode:async(_a,block)=>block===9?'0x':'0x6000'};
  assert.equal((await validatePublicDeployment(provider,artifact,address,10)).chainId,'84532');
  await assert.rejects(validatePublicDeployment({...provider,getNetwork:async()=>({chainId:1n})},artifact,address,10),/Base Sepolia/);
  await assert.rejects(validatePublicDeployment(provider,{deployedBytecode:'0x6001'},address,10),/runtime/);
  await assert.rejects(validatePublicDeployment(provider,artifact,address,11),/creation/);
});

test('confirmation checks reject reverted and reorganized transactions', async () => {
  const hash='0x'+'12'.repeat(32);
  await assert.rejects(confirmedReceipt({waitForTransaction:async()=>({status:0})},hash),/failed/);
  await assert.rejects(confirmedReceipt({waitForTransaction:async()=>({status:1,blockNumber:1,blockHash:hash}),getBlock:async()=>({hash:'0x'+'34'.repeat(32)})},hash),/canonical/);
});

test('public HTTP issues secure sessions and rejects foreign origins, hosts and unauthenticated writes', async () => {
  const scopes=[];
  const service={state:async scope=>{scopes.push(scope);return {ok:true};},createMandate:async(_data,scope)=>({scope})};
  const server=createHttpServer(service,{mode:'base-sepolia',publicMode:true,publicOrigin:'https://prooflane.example',sessionSecret:secret});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  // Native HTTP deliberately sets the proxy-facing Host. fetch normalizes Host
  // from its URL, which would test localhost rejection instead of the public API.
  const fetch=(address,options={})=>new Promise((resolve,reject)=>{
    const req=request(address,{method:options.method,headers:options.headers},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode,headers:{get:key=>{const value=response.headers[key.toLowerCase()];return Array.isArray(value)?value[0]:value??null;}},json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));
    });
    req.on('error',reject);req.end(options.body);
  });
  const headers={host:'prooflane.example','content-type':'application/json','x-prooflane-client':'prooflane-v1'};
  try {
    const a=await fetch(url+'/api/state',{headers}); const b=await fetch(url+'/api/state',{headers});
    assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(scopes[0],scopes[1]);
    const cookie=a.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(url+'/api/mandates',{method:'POST',headers,body:'{}'})).status,401);
    assert.equal((await fetch(url+'/api/mandates',{method:'POST',headers:{...headers,cookie,origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(url+'/api/state',{headers:{...headers,host:'evil.example'}})).status,403);
    const accepted=await fetch(url+'/api/mandates',{method:'POST',headers:{...headers,cookie,origin:'https://prooflane.example'},body:'{}'});
    assert.equal(accepted.status,200);assert.equal((await accepted.json()).scope,scopes[0]);
    const health=await fetch(url+'/api/health'); assert.equal(health.status,200);assert.equal(health.headers.get('set-cookie'),null);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
