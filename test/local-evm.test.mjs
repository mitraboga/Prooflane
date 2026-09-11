import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Contract, ContractFactory, HDNodeWallet, toQuantity } from 'ethers';
import solc from 'solc';
import { DEV_MNEMONIC, startEvm } from '../src/local-evm.mjs';

const source = 'pragma solidity ^0.8.28; contract PersistProbe { uint256 public value; event Changed(uint256 indexed oldValue, uint256 newValue); function set(uint256 next) external { emit Changed(value, next); value = next; } }';
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'PersistProbe.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
assert.equal(compiled.errors?.some(error => error.severity === 'error') ?? false, false);
const artifact = compiled.contracts['PersistProbe.sol'].PersistProbe;

test('Anvil restarts with exact state, historical calls, blocks, transaction receipts and event logs', { timeout: 90_000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'prooflane-persistence-'));
  let evm = await startEvm({ dataDir });
  t.after(async () => { await evm?.close(); await rm(dataDir, { recursive: true, force: true }); });
  assert.ok(evm.port > 0);
  assert.match(evm.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(BigInt(await evm.request({ method: 'eth_chainId' })), 31337n);
  const signer = await evm.provider.getSigner(0);
  assert.equal(await signer.getAddress(), HDNodeWallet.fromPhrase(DEV_MNEMONIC).address);
  const deployed = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy();
  await deployed.waitForDeployment();
  const address = await deployed.getAddress();
  const first = await (await deployed.set(7)).wait();
  const second = await (await deployed.set(11)).wait();
  const request = (method, params) => evm.request({ method, params });
  const filter = { address, fromBlock: '0x0', toBlock: 'latest' };
  const before = {
    receipt1: await request('eth_getTransactionReceipt', [first.hash]),
    receipt2: await request('eth_getTransactionReceipt', [second.hash]),
    transaction: await request('eth_getTransactionByHash', [first.hash]),
    block1: await request('eth_getBlockByNumber', [toQuantity(first.blockNumber), false]),
    block2: await request('eth_getBlockByHash', [second.blockHash, false]),
    logs: await request('eth_getLogs', [filter]),
    historicalValue: await request('eth_call', [{ to: address, data: deployed.interface.encodeFunctionData('value') }, toQuantity(first.blockNumber)]),
    code: await evm.provider.getCode(address),
  };
  assert.equal(before.logs.length, 2);
  assert.equal(BigInt(before.historicalValue), 7n);
  assert.equal(await deployed.value(), 11n);
  assert.equal((await evm.snapshot()).persisted, true);
  const saved = JSON.parse(await readFile(join(dataDir, 'anvil-state.json'), 'utf8'));
  assert.equal(saved.anvilVersion, '1.7.1');
  assert.ok(saved.state.startsWith('0x1f8b'), 'State dump uses Anvil gzip payload');
  await evm.close();
  evm = await startEvm({ dataDir });
  const restored = new Contract(address, artifact.abi, await evm.provider.getSigner(0));
  assert.equal(await restored.value(), 11n, 'Latest contract storage survives');
  assert.equal(await evm.provider.getCode(address), before.code, 'Deployed contract code survives');
  assert.deepEqual(await request('eth_getTransactionReceipt', [first.hash]), before.receipt1, 'Older transaction receipt survives exactly');
  assert.deepEqual(await request('eth_getTransactionReceipt', [second.hash]), before.receipt2, 'Latest transaction receipt survives exactly');
  assert.deepEqual(await request('eth_getTransactionByHash', [first.hash]), before.transaction, 'Transaction envelope and block association survive');
  assert.deepEqual(await request('eth_getBlockByNumber', [toQuantity(first.blockNumber), false]), before.block1, 'Historical block survives exactly');
  assert.deepEqual(await request('eth_getBlockByHash', [second.blockHash, false]), before.block2, 'Block lookup by hash survives');
  assert.deepEqual(await request('eth_getLogs', [filter]), before.logs, 'Historical event logs survive exactly');
  assert.equal(await request('eth_call', [{ to: address, data: restored.interface.encodeFunctionData('value') }, toQuantity(first.blockNumber)]), before.historicalValue, 'Historical storage call survives');
  const third = await (await restored.set(19)).wait();
  assert.ok(third.blockNumber > second.blockNumber, 'Mining continues after restored head');
  assert.equal(await restored.value(), 19n);
  assert.equal((await request('eth_getLogs', [filter])).length, 3);
  assert.deepEqual(await request('eth_getTransactionReceipt', [first.hash]), before.receipt1, 'New mining leaves historical receipts unchanged');
});

test('independent port-zero Anvil instances and development time controls work', { timeout: 60_000 }, async t => {
  const first = await startEvm();
  t.after(() => first.close());
  const second = await startEvm();
  t.after(() => second.close());
  assert.notEqual(first.port, second.port);
  const block = await first.provider.getBlock('latest');
  await first.request({ method: 'evm_setNextBlockTimestamp', params: [block.timestamp + 3600] });
  await first.request({ method: 'evm_mine', params: [] });
  assert.equal((await first.provider.getBlock('latest')).timestamp, block.timestamp + 3600);
  assert.equal(await second.provider.getBlockNumber(), 0);
  const snapshot = await first.request({ method: 'evm_snapshot', params: [] });
  await first.request({ method: 'evm_mine', params: [] });
  assert.equal(await first.request({ method: 'evm_revert', params: [snapshot] }), true);
});
