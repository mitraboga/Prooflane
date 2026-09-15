import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/testnet-vault.mjs', import.meta.url));
const run = (cwd, action, input) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script, action], { cwd, windowsHide:true, stdio:['pipe','pipe','pipe'] });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  child.stdin.end(JSON.stringify(input));
});

test('portable wallet survives process changes, verifies both signers, rejects wrong passwords and preserves existing files', {timeout:120000}, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'prooflane-vault-'));
  const password='Test-only portable passphrase \u03bb\u00e9';
  try {
    await mkdir(join(directory,'data'));
    const legacy=join(directory,'data','testnet-keys.encrypted.json');
    await writeFile(legacy,'legacy encrypted bytes remain untouched');
    const created=await run(directory,'InitializePortable',{password,confirmation:password});
    assert.equal(created.code,0,created.stderr);
    const addresses=JSON.parse(created.stdout);assert.notEqual(addresses.owner,addresses.agent);
    const verified=await run(directory,'Verify',{password});assert.equal(verified.code,0,verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout),{verified:true,...addresses});
    const wrong=await run(directory,'Verify',{password:'Wrong test-only password'});
    assert.notEqual(wrong.code,0);assert.match(wrong.stderr,/Cannot unlock/);
    const before=await readFile(join(directory,'data','testnet-keys.portable.json'),'utf8');
    assert.equal(before.includes(password),false);assert.equal(/0x[\da-f]{64}/i.test(before),false);
    const repeat=await run(directory,'InitializePortable',{password,confirmation:password});assert.notEqual(repeat.code,0);
    assert.equal(await readFile(join(directory,'data','testnet-keys.portable.json'),'utf8'),before);
    assert.equal(await readFile(legacy,'utf8'),'legacy encrypted bytes remain untouched');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('portable initialization refuses mismatched passwords and existing deployment intents',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'prooflane-vault-'));
  const password='Test-only long passphrase';
  try {
    assert.notEqual((await run(directory,'InitializePortable',{password,confirmation:'different'})).code,0);
    await mkdir(join(directory,'data'));await writeFile(join(directory,'data','base-sepolia-deployment-intent.json'),'{}');
    const result=await run(directory,'InitializePortable',{password,confirmation:password});
    assert.notEqual(result.code,0);assert.match(result.stderr,/deployment or saved transaction/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
