/**
 * EDUCATION ONLY: a small model of SHA-256d, proof of work and a UTXO ledger.
 * This is not Bitcoin consensus code and cannot send or receive bitcoin.
 * It intentionally omits scripts/signatures, networking, coinbase maturity,
 * Bitcoin byte-order/wire encoding, difficulty retargeting and chain selection.
 * `owner` is a label, not an authenticated spend authorization.
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const EDUCATIONAL_NOTICE = 'Education only: simplified PoW/UTXO model; no real Bitcoin, spending authentication or consensus compatibility.';
const MAX_VALUE = (1n << 64n) - 1n;
function assert(condition, message) { if (!condition) throw new TypeError(message); }
function hashValue(hash) { assert(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash), 'Expected a lowercase 32-byte hash'); return hash; }
function amount(value) {
  assert(typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20, 'Value must be a positive canonical decimal string');
  const parsed = BigInt(value);
  assert(parsed <= MAX_VALUE, 'Value exceeds this model\'s uint64 limit');
  return parsed;
}
function outputValue(output) {
  assert(output && typeof output.owner === 'string' && output.owner.length > 0 && output.owner.length <= 100, 'Each output needs an owner label');
  amount(output.value);
  return { owner: output.owner, value: output.value };
}
function normalizedTransaction(transaction) {
  assert(transaction && Array.isArray(transaction.inputs) && Array.isArray(transaction.outputs), 'Expected inputs and outputs arrays');
  assert(transaction.outputs.length > 0, 'A transaction needs at least one output');
  return {
    inputs: transaction.inputs.map(input => {
      hashValue(input.txid);
      assert(Number.isSafeInteger(input.index) && input.index >= 0, 'Output index must be a nonnegative safe integer');
      return { txid: input.txid, index: input.index };
    }),
    outputs: transaction.outputs.map(outputValue),
  };
}
export function doubleSha256(value) {
  return createHash('sha256').update(createHash('sha256').update(value).digest()).digest('hex');
}
export function hashTransaction(transaction) { return doubleSha256(JSON.stringify(normalizedTransaction(transaction))); }

/** Duplicate an odd final node, as in a Bitcoin-style Merkle tree (different from Prooflane). */
export function bitcoinMerkleRoot(transactionHashes) {
  assert(Array.isArray(transactionHashes) && transactionHashes.length > 0, 'A block needs at least one transaction hash');
  let level = transactionHashes.map(hashValue);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(doubleSha256(Buffer.from(level[i] + (level[i + 1] ?? level[i]), 'hex')));
    }
    level = next;
  }
  return level[0];
}

/** Seed one illustrative funding output; the model has no mining subsidy. */
export function createGenesisUtxo(owner, value) {
  const transaction = normalizedTransaction({ inputs: [], outputs: [{ owner, value }] });
  const txid = hashTransaction(transaction);
  return { txid, transaction, utxos: new Map([[`${txid}:0`, transaction.outputs[0]]]) };
}

/** Pure transition: failed validation never changes the caller's UTXO set. */
export function applyTransaction(utxos, transaction) {
  assert(utxos instanceof Map, 'UTXO set must be a Map');
  const normalized = normalizedTransaction(transaction);
  assert(normalized.inputs.length > 0, 'Ordinary transactions require at least one input');
  const spent = new Set();
  let totalInput = 0n;
  for (const input of normalized.inputs) {
    const outpoint = `${input.txid}:${input.index}`;
    assert(!spent.has(outpoint), 'Double spend: an input is repeated within the transaction');
    const previous = utxos.get(outpoint);
    assert(previous, 'Double spend or missing input: the output is already spent or does not exist');
    totalInput += amount(previous.value);
    spent.add(outpoint);
  }
  const totalOutput = normalized.outputs.reduce((total, output) => total + amount(output.value), 0n);
  assert(totalOutput <= totalInput, 'Outputs exceed inputs: value cannot be created');
  const next = new Map(utxos);
  const txid = hashTransaction(normalized);
  for (const outpoint of spent) next.delete(outpoint);
  normalized.outputs.forEach((output, index) => {
    const outpoint = `${txid}:${index}`;
    assert(!next.has(outpoint), 'Transaction output already exists');
    next.set(outpoint, { ...output });
  });
  return { utxos: next, txid, fee: String(totalInput - totalOutput) };
}

function normalizedHeader(block) {
  hashValue(block.previousHash);
  hashValue(block.merkleRoot);
  assert(Number.isSafeInteger(block.timestamp) && block.timestamp >= 0, 'Timestamp must be a nonnegative safe integer');
  assert(Number.isInteger(block.difficulty) && block.difficulty >= 1 && block.difficulty <= 4, 'Educational difficulty must be 1 through 4 leading hex zeroes');
  assert(Number.isSafeInteger(block.nonce) && block.nonce >= 0, 'Nonce must be a nonnegative safe integer');
  return { previousHash: block.previousHash, merkleRoot: block.merkleRoot, timestamp: block.timestamp, difficulty: block.difficulty, nonce: block.nonce };
}
export function hashBlock(block) { return doubleSha256(JSON.stringify(normalizedHeader(block))); }

export function mineBlock({ previousHash = '0'.repeat(64), transactions, difficulty = 2, timestamp = 1_700_000_000, maxNonce = 1_000_000 }) {
  assert(Number.isSafeInteger(maxNonce) && maxNonce >= 0, 'maxNonce must be a nonnegative safe integer');
  assert(Array.isArray(transactions), 'Expected a transactions array');
  const normalized = transactions.map(normalizedTransaction);
  const merkleRoot = bitcoinMerkleRoot(normalized.map(hashTransaction));
  const block = { previousHash, merkleRoot, timestamp, difficulty, nonce: 0, transactions: normalized };
  normalizedHeader(block);
  for (let nonce = 0; nonce <= maxNonce; nonce++) {
    block.nonce = nonce;
    const hash = hashBlock(block);
    if (hash.startsWith('0'.repeat(difficulty))) return { ...block, hash };
  }
  throw new Error('No proof of work found within maxNonce');
}

/** Verifies commitments and work only; applying transactions is a separate ledger transition. */
export function verifyBlock(block, expectedPreviousHash = block?.previousHash, expectedDifficulty = 2) {
  try {
    normalizedHeader(block);
    hashValue(expectedPreviousHash);
    hashValue(block.hash);
    assert(block.difficulty === expectedDifficulty, 'Difficulty does not match the verifier\'s expected difficulty');
    const root = bitcoinMerkleRoot(block.transactions.map(hashTransaction));
    return block.previousHash === expectedPreviousHash && root === block.merkleRoot
      && hashBlock(block) === block.hash && block.hash.startsWith('0'.repeat(expectedDifficulty));
  } catch { return false; }
}

export function runDemo() {
  const genesis = createGenesisUtxo('Alice', '100');
  const payment = {
    inputs: [{ txid: genesis.txid, index: 0 }],
    outputs: [{ owner: 'Bob', value: '60' }, { owner: 'Alice', value: '39' }],
  };
  const accepted = applyTransaction(genesis.utxos, payment);
  const block = mineBlock({ transactions: [payment] });
  let rejectedDoubleSpend;
  try { applyTransaction(accepted.utxos, payment); } catch (error) { rejectedDoubleSpend = error.message; }
  const tampered = structuredClone(block);
  tampered.transactions[0].outputs[0].value = '61';
  return {
    notice: EDUCATIONAL_NOTICE,
    transactionId: accepted.txid,
    fee: accepted.fee,
    remainingOutputs: [...accepted.utxos.values()],
    proofOfWork: { hash: block.hash, nonce: block.nonce, difficulty: block.difficulty },
    validBlock: verifyBlock(block),
    tamperedBlockAccepted: verifyBlock(tampered),
    rejectedDoubleSpend,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runDemo(), null, 2));
}
