import assert from 'node:assert/strict';
import test from 'node:test';
import { startEvm, DEV_MNEMONIC } from '../src/local-evm.mjs';
import { ContractFactory, HDNodeWallet, TypedDataEncoder, ZeroAddress, ZeroHash, concat, id, keccak256, toBeHex } from 'ethers';
import { compileProoflane } from './compile.mjs';

const artifact = compileProoflane();
const TYPES = {
  Receipt: [
    { name: 'mandateId', type: 'bytes32' },
    { name: 'actionHash', type: 'bytes32' },
    { name: 'inputHash', type: 'bytes32' },
    { name: 'outputHash', type: 'bytes32' },
    { name: 'cost', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

function pair(a, b) {
  return keccak256(concat(BigInt(a) < BigInt(b) ? [a, b] : [b, a]));
}

/** Independent off-chain implementation checks agreement with Solidity. */
function merkle(leaves) {
  assert.ok(leaves.length > 0);
  const levels = [[...leaves]];
  while (levels.at(-1).length > 1) {
    const row = levels.at(-1);
    const next = [];
    for (let i = 0; i < row.length; i += 2) next.push(i + 1 < row.length ? pair(row[i], row[i + 1]) : row[i]);
    levels.push(next);
  }
  return {
    root: levels.at(-1)[0],
    proof(index) {
      const proof = [];
      for (let depth = 0; depth < levels.length - 1; depth++) {
        const sibling = index ^ 1;
        if (sibling < levels[depth].length) proof.push(levels[depth][sibling]);
        index = Math.floor(index / 2);
      }
      return proof;
    },
  };
}

async function fixture(t, overrides = {}) {
  const chain = await startEvm({ port: 0 });
  const provider = chain.provider;
  t.after(async () => { await chain.close(); });
  const owner = await provider.getSigner(0);
  const relayer = await provider.getSigner(1);
  const agent = HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, "m/44'/60'/0'/0/2");
  const other = HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, "m/44'/60'/0'/0/3");
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy();
  await contract.waitForDeployment();
  const actions = ['research.web_search', 'document.summarize', 'report.export'].map(id);
  const actionTree = merkle(actions);
  const mandateId = id('prooflane:test:owner:mandate:1');
  const block = await provider.getBlock('latest');
  const policy = { budget: 100n, cap: 40n, expiresAt: block.timestamp + 3600, ...overrides };
  await (await contract.createMandate(mandateId, agent.address, actionTree.root, policy.budget, policy.cap, policy.expiresAt)).wait();
  const domain = { name: 'Prooflane', version: '1', chainId: 31337, verifyingContract: await contract.getAddress() };
  return { chain, provider, owner, relayer, agent, other, contract, actions, actionTree, mandateId, policy, domain };
}

function receipt(f, overrides = {}) {
  return {
    mandateId: f.mandateId,
    actionHash: f.actions[0],
    inputHash: id('synthetic request; no secret inputs on chain'),
    outputHash: id('synthetic result'),
    cost: 10n,
    nonce: 0n,
    ...overrides,
  };
}

async function prepare(f, receipts, options = {}) {
  const signatures = await Promise.all(receipts.map((item) => (options.signer ?? f.agent).signTypedData(options.domain ?? f.domain, TYPES, item)));
  const proofs = receipts.map((item) => {
    const index = f.actions.indexOf(item.actionHash);
    return index < 0 ? [] : f.actionTree.proof(index);
  });
  return { receipts, signatures, proofs };
}

async function settle(f, batch) {
  return (await f.contract.connect(f.relayer).settleBatch(f.mandateId, batch.receipts, batch.signatures, batch.proofs)).wait();
}

function errorData(error) {
  return error.data ?? error.info?.error?.data?.result ?? error.info?.error?.data;
}

async function rejects(f, promise, expected) {
  await assert.rejects(promise, (error) => {
    const data = errorData(error);
    const parsed = typeof data === 'string' ? f.contract.interface.parseError(data) : null;
    assert.equal(parsed?.name, expected, `Expected ${expected}; got ${error.shortMessage ?? error.message}`);
    return true;
  });
}

function simulate(f, batch, mandateId = f.mandateId) {
  return f.contract.connect(f.relayer).settleBatch.staticCall(mandateId, batch.receipts, batch.signatures, batch.proofs);
}

test('valid odd-sized batch: EIP-712 digest, action allowlist, event, accounting and all Merkle proofs', async (t) => {
  const f = await fixture(t);
  const receipts = [0, 1, 2].map((i) => receipt(f, { nonce: BigInt(i), actionHash: f.actions[i], cost: BigInt(i + 1) * 10n }));
  const batch = await prepare(f, receipts);
  const leaves = receipts.map((item) => TypedDataEncoder.hash(f.domain, TYPES, item));
  for (let i = 0; i < receipts.length; i++) assert.equal(await f.contract.hashReceipt(receipts[i]), leaves[i]);
  const tree = merkle(leaves);
  assert.equal(await simulate(f, batch), tree.root);
  const transaction = await settle(f, batch);
  const event = transaction.logs.map((log) => { try { return f.contract.interface.parseLog(log); } catch { return null; } }).find((log) => log?.name === 'BatchAnchored');
  assert.equal(event.args.mandateId, f.mandateId);
  assert.equal(event.args.root, tree.root);
  assert.equal(event.args.previousRoot, ZeroHash);
  assert.equal(event.args.totalCost, 60n);
  assert.equal(event.args.count, 3n);
  assert.equal(event.args.relayer, await f.relayer.getAddress());
  const mandate = await f.contract.mandates(f.mandateId);
  assert.equal(mandate.spent, 60n);
  assert.equal(mandate.nextNonce, 3n);
  assert.equal(mandate.latestRoot, tree.root);
  const anchored = await f.contract.batches(tree.root);
  assert.equal(anchored.exists, true);
  assert.equal(anchored.mandateId, f.mandateId);
  assert.equal(anchored.count, 3n);
  for (let i = 0; i < leaves.length; i++) assert.equal(await f.contract.verifyReceipt(tree.root, leaves[i], tree.proof(i)), true);
  assert.equal(tree.proof(2).length, 1, 'odd third leaf is promoted, not duplicated');
  assert.notEqual(tree.root, pair(pair(leaves[0], leaves[1]), pair(leaves[2], leaves[2])));
  assert.equal(await f.contract.verifyReceipt(tree.root, id('tampered-leaf'), tree.proof(0)), false);
  assert.equal(await f.contract.verifyReceipt(tree.root, tree.root, []), false);
  assert.equal(await f.contract.verifyReceipt(id('not-anchored'), leaves[0], tree.proof(0)), false);
});

test('one-leaf batches link previousRoot and are independently verifiable', async (t) => {
  const f = await fixture(t);
  const first = receipt(f);
  await settle(f, await prepare(f, [first]));
  const firstRoot = TypedDataEncoder.hash(f.domain, TYPES, first);
  assert.equal(await f.contract.verifyReceipt(firstRoot, firstRoot, []), true);
  const second = receipt(f, { nonce: 1n, cost: 15n });
  await settle(f, await prepare(f, [second]));
  const secondRoot = TypedDataEncoder.hash(f.domain, TYPES, second);
  const anchored = await f.contract.batches(secondRoot);
  assert.equal(anchored.previousRoot, firstRoot);
  assert.equal(anchored.totalCost, 15n);
  assert.equal((await f.contract.mandates(f.mandateId)).spent, 25n);
});

test('tampering with signed input, output or cost invalidates signatures', async (t) => {
  const f = await fixture(t);
  for (const patch of [{ inputHash: id('changed-input') }, { outputHash: id('changed-output') }, { cost: 11n }]) {
    const batch = await prepare(f, [receipt(f)]);
    batch.receipts[0] = { ...batch.receipts[0], ...patch };
    await rejects(f, simulate(f, batch), 'InvalidSignature');
  }
});

test('wrong signer, chain, contract, or typed-data version cannot authorize a receipt', async (t) => {
  const f = await fixture(t);
  const receipts = [receipt(f)];
  const cases = [
    { signer: f.other },
    { domain: { ...f.domain, chainId: 1 } },
    { domain: { ...f.domain, verifyingContract: f.other.address } },
    { domain: { ...f.domain, version: '2' } },
  ];
  for (const options of cases) await rejects(f, simulate(f, await prepare(f, receipts, options)), 'InvalidSignature');
});

test('rejects malleable high-s signatures, malformed signatures and invalid recovery id', async (t) => {
  const f = await fixture(t);
  const batch = await prepare(f, [receipt(f)]);
  const sig = batch.signatures[0];
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = Number.parseInt(sig.slice(130, 132), 16);
  const highS = concat([sig.slice(0, 66), toBeHex(order - s, 32), toBeHex(v === 27 ? 28 : 27, 1)]);
  for (const invalid of [highS, '0x1234', `${sig.slice(0, 130)}00`, `0x${'00'.repeat(64)}1b`]) {
    await rejects(f, simulate(f, { ...batch, signatures: [invalid] }), 'InvalidSignature');
  }
});

test('nonce enforces replay rejection and rejects gaps, duplicates and out-of-order receipts', async (t) => {
  const f = await fixture(t);
  await rejects(f, simulate(f, await prepare(f, [receipt(f, { nonce: 1n })])), 'InvalidNonce');
  await rejects(f, simulate(f, await prepare(f, [receipt(f), receipt(f)])), 'InvalidNonce');
  const batch = await prepare(f, [receipt(f)]);
  await settle(f, batch);
  await rejects(f, simulate(f, batch), 'InvalidNonce');
  await rejects(f, simulate(f, await prepare(f, [receipt(f, { nonce: 2n }), receipt(f, { nonce: 1n })])), 'InvalidNonce');
});

test('forbidden action and wrong allowlist proof are rejected', async (t) => {
  const f = await fixture(t);
  await rejects(f, simulate(f, await prepare(f, [receipt(f, { actionHash: id('wallet.transfer') })])), 'ActionNotAllowed');
  const batch = await prepare(f, [receipt(f)]);
  batch.proofs[0] = f.actionTree.proof(2);
  await rejects(f, simulate(f, batch), 'ActionNotAllowed');
});

test('per-receipt cap and cumulative budget enforce signed cost limits', async (t) => {
  const f = await fixture(t);
  await rejects(f, simulate(f, await prepare(f, [receipt(f, { cost: 41n })])), 'ReceiptCapExceeded');
  await settle(f, await prepare(f, [receipt(f, { cost: 40n }), receipt(f, { cost: 40n, nonce: 1n })]));
  await rejects(f, simulate(f, await prepare(f, [receipt(f, { cost: 21n, nonce: 2n })])), 'BudgetExceeded');
  await settle(f, await prepare(f, [receipt(f, { cost: 20n, nonce: 2n })]));
  assert.equal((await f.contract.mandates(f.mandateId)).spent, 100n);
});

test('a failed real transaction leaves no partial nonce, spend or root change', async (t) => {
  const f = await fixture(t);
  const first = receipt(f, { cost: 40n });
  const batch = await prepare(f, [first, receipt(f, { cost: 41n, nonce: 1n })]);
  const tx = await f.contract.connect(f.relayer).settleBatch(f.mandateId, batch.receipts, batch.signatures, batch.proofs, { gasLimit: 2000000 });
  await assert.rejects(tx.wait());
  const after = await f.contract.mandates(f.mandateId);
  assert.equal(after.spent, 0n);
  assert.equal(after.nextNonce, 0n);
  assert.equal(after.latestRoot, ZeroHash);
  assert.equal((await f.contract.batches(TypedDataEncoder.hash(f.domain, TYPES, first))).exists, false);
  await settle(f, await prepare(f, [first]));
  assert.equal((await f.contract.mandates(f.mandateId)).nextNonce, 1n);
});

test('expiry rejects settlement at the expiry boundary', async (t) => {
  const f = await fixture(t);
  const batch = await prepare(f, [receipt(f)]);
  await f.chain.request({ method: 'evm_setNextBlockTimestamp', params: [f.policy.expiresAt] });
  await f.chain.request({ method: 'evm_mine', params: [] });
  assert.ok((await f.provider.getBlock('latest')).timestamp >= f.policy.expiresAt);
  await rejects(f, simulate(f, batch), 'MandateExpired');
});

test('only owner can revoke and revoked mandates permanently reject settlement', async (t) => {
  const f = await fixture(t);
  await rejects(f, f.contract.connect(f.relayer).revokeMandate.staticCall(f.mandateId), 'Unauthorized');
  await (await f.contract.revokeMandate(f.mandateId)).wait();
  assert.equal((await f.contract.mandates(f.mandateId)).revoked, true);
  await rejects(f, simulate(f, await prepare(f, [receipt(f)])), 'MandateRevoked');
  await rejects(f, f.contract.revokeMandate.staticCall(f.mandateId), 'MandateRevoked');
});

test('mandate creation rejects invalid and duplicate policies', async (t) => {
  const f = await fixture(t);
  const freshId = id('fresh-mandate');
  const valid = [freshId, f.agent.address, f.actionTree.root, 100n, 40n, f.policy.expiresAt];
  const changes = [[0, ZeroHash], [1, ZeroAddress], [2, ZeroHash], [3, 0n], [4, 0n], [4, 101n], [5, 1]];
  for (const [index, value] of changes) {
    const args = [...valid]; args[index] = value;
    await rejects(f, f.contract.createMandate.staticCall(...args), 'InvalidMandate');
  }
  await rejects(f, f.contract.createMandate.staticCall(f.mandateId, ...valid.slice(1)), 'MandateAlreadyExists');
});

test('unknown mandates, mismatched ids and malformed batch shapes are rejected', async (t) => {
  const f = await fixture(t);
  const batch = await prepare(f, [receipt(f)]);
  await rejects(f, simulate(f, batch, id('unknown')), 'MandateNotFound');
  await rejects(f, f.contract.revokeMandate.staticCall(id('unknown')), 'MandateNotFound');
  const mismatch = await prepare(f, [receipt(f, { mandateId: id('another-mandate') })]);
  await rejects(f, simulate(f, mismatch), 'MandateMismatch');
  for (const malformed of [
    { receipts: [], signatures: [], proofs: [] },
    { ...batch, signatures: [] },
    { ...batch, proofs: [] },
    { receipts: Array(33).fill(batch.receipts[0]), signatures: Array(33).fill(batch.signatures[0]), proofs: Array(33).fill(batch.proofs[0]) },
  ]) await rejects(f, simulate(f, malformed), 'InvalidBatch');
});

test('maximum 32-receipt batch anchors, with every proof verifiable', async (t) => {
  const f = await fixture(t);
  const receipts = Array.from({ length: 32 }, (_, i) => receipt(f, { cost: 1n, nonce: BigInt(i) }));
  const batch = await prepare(f, receipts);
  await settle(f, batch);
  const tree = merkle(receipts.map((item) => TypedDataEncoder.hash(f.domain, TYPES, item)));
  assert.equal((await f.contract.mandates(f.mandateId)).nextNonce, 32n);
  assert.equal((await f.contract.batches(tree.root)).count, 32n);
  for (let i = 0; i < receipts.length; i++) {
    assert.equal(await f.contract.verifyReceipt(tree.root, TypedDataEncoder.hash(f.domain, TYPES, receipts[i]), tree.proof(i)), true);
  }
});
