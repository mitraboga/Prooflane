import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTransaction, bitcoinMerkleRoot, createGenesisUtxo, doubleSha256, hashBlock, hashTransaction, mineBlock, runDemo, verifyBlock } from '../labs/bitcoin.mjs';

function fixture() {
  const genesis = createGenesisUtxo('Alice', '100');
  const payment = { inputs: [{ txid: genesis.txid, index: 0 }], outputs: [{ owner: 'Bob', value: '60' }, { owner: 'Alice', value: '39' }] };
  return { genesis, payment };
}

test('SHA-256d has a known empty-string vector', () => {
  assert.equal(doubleSha256(''), '5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456');
});
test('a payment consumes its inputs, creates change, and preserves its fee', () => {
  const { genesis, payment } = fixture();
  const accepted = applyTransaction(genesis.utxos, payment);
  assert.equal(accepted.fee, '1');
  assert.equal(accepted.utxos.size, 2);
  assert.equal(genesis.utxos.size, 1, 'Original UTXO set stays unchanged');
  assert.equal(accepted.utxos.has(`${genesis.txid}:0`), false);
  assert.deepEqual(accepted.utxos.get(`${accepted.txid}:1`), { owner: 'Alice', value: '39' });
});
test('ledger rejects already-spent, duplicate, and nonexistent inputs atomically', () => {
  const { genesis, payment } = fixture();
  const accepted = applyTransaction(genesis.utxos, payment);
  assert.throws(() => applyTransaction(accepted.utxos, payment), /Double spend/);
  const duplicate = structuredClone(payment);
  duplicate.inputs.push(duplicate.inputs[0]);
  assert.throws(() => applyTransaction(genesis.utxos, duplicate), /repeated/);
  const missing = structuredClone(payment);
  missing.inputs[0].index = 9;
  assert.throws(() => applyTransaction(genesis.utxos, missing), /missing input/);
  assert.equal(genesis.utxos.size, 1);
});
test('ledger rejects inflation, malformed amounts and coinbase-like ordinary transactions', () => {
  const { genesis, payment } = fixture();
  const inflated = structuredClone(payment);
  inflated.outputs[0].value = '101';
  assert.throws(() => applyTransaction(genesis.utxos, inflated), /Outputs exceed inputs/);
  for (const invalid of ['-1', '0', '1.5', '01', '18446744073709551616', 60]) {
    const malformed = structuredClone(payment);
    malformed.outputs[0].value = invalid;
    assert.throws(() => applyTransaction(genesis.utxos, malformed));
  }
  assert.throws(() => applyTransaction(genesis.utxos, { inputs: [], outputs: payment.outputs }), /at least one input/);
});
test('educational PoW validates and detects edited transactions, parent hashes and nonces', () => {
  const { payment } = fixture();
  const block = mineBlock({ transactions: [payment] });
  assert.equal(verifyBlock(block), true);
  assert.equal(block.hash.startsWith('00'), true);
  assert.equal(hashBlock(block), block.hash);
  const edited = structuredClone(block);
  edited.transactions[0].outputs[0].value = '61';
  assert.equal(verifyBlock(edited), false);
  assert.equal(verifyBlock(block, 'f'.repeat(64)), false);
  assert.equal(verifyBlock({ ...block, nonce: block.nonce + 1 }), false);
  assert.equal(verifyBlock(block, block.previousHash, 3), false);
});
test('Bitcoin-style Merkle tree duplicates an odd node; transaction object key order is stable', () => {
  const { payment } = fixture();
  assert.equal(hashTransaction(payment), hashTransaction({ outputs: payment.outputs, inputs: payment.inputs }));
  const leaves = ['a', 'b', 'c'].map(doubleSha256);
  const left = doubleSha256(Buffer.from(leaves[0] + leaves[1], 'hex'));
  const right = doubleSha256(Buffer.from(leaves[2] + leaves[2], 'hex'));
  assert.equal(bitcoinMerkleRoot(leaves), doubleSha256(Buffer.from(left + right, 'hex')));
});
test('demo makes both educational limitations and rejection evidence explicit', () => {
  const result = runDemo();
  assert.match(result.notice, /Education only/);
  assert.equal(result.validBlock, true);
  assert.equal(result.tamperedBlockAccepted, false);
  assert.match(result.rejectedDoubleSpend, /Double spend/);
});
