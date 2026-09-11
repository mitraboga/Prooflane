import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, TypedDataEncoder, ZeroHash, id, sha256, toUtf8Bytes } from 'ethers';
import { RECEIPT_TYPES, actionHash, canonicalJson, contentHash, domainFor, merkleTree, receiptHash, verifyBundle, verifyMerkle } from '../src/protocol.mjs';

// Public, deterministic test-only keys. Never fund these accounts.
const agent = new Wallet(`0x${'11'.repeat(32)}`);
const other = new Wallet(`0x${'22'.repeat(32)}`);
const contract = '0x0000000000000000000000000000000000001234';

async function fixture() {
  const names = ['repo.read', 'ci.run', 'release.publish'];
  const allowlist = merkleTree(names.map(actionHash));
  const policy = {
    id: id('test-mandate'), owner: other.address, agent: agent.address,
    actionRoot: allowlist.root, budget: '1000000', maxPerReceipt: '10000', expiresAt: '2000000000',
  };
  const input = { repository: 'prooflane/example', revision: 'abc123', options: { lint: true, tests: ['unit', 'integration'] } };
  const output = { status: 'passed', tests: 42, durationMs: 1532 };
  const domain = domainFor(31337, contract);
  const receipt = { mandateId: policy.id, actionHash: actionHash('ci.run'), inputHash: contentHash(input), outputHash: contentHash(output), cost: '250', nonce: '9007199254740993' };
  const signature = await agent.signTypedData(domain, RECEIPT_TYPES, receipt);
  const anchors = merkleTree([id('different-receipt'), receiptHash(domain, receipt), id('third-receipt')]);
  return {
    schema: 'prooflane.receipt.v1', domain, receipt, signature, agent: agent.address,
    policy, action: { name: 'ci.run', proof: allowlist.proofs[1] }, input, output,
    anchor: { root: anchors.root, proof: anchors.proofs[1], transactionHash: id('test-transaction'), blockNumber: 123, chainId: '31337', contractAddress: contract },
  };
}
const failures = result => result.checks.filter(check => !check.valid).map(check => check.name);

test('canonical JSON sorts nested keys without reordering arrays or coercing values', () => {
  assert.equal(canonicalJson({ z: 1, a: { c: [3, { b: '😀', a: null }], a: true } }), '{"a":{"a":true,"c":[3,{"a":null,"b":"😀"}]},"z":1}');
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
  assert.notEqual(contentHash([1, 2]), contentHash([2, 1]));
  assert.equal(contentHash({ b: 2, a: 1 }), sha256(toUtf8Bytes('{"a":1,"b":2}')));
  assert.equal(canonicalJson(-0), '0');
  assert.equal(canonicalJson({ text: '\ud800' }), '{"text":"\\ud800"}');
});

test('canonical JSON fails closed on lossy values, cycles, sparse arrays and accessors', () => {
  const cycle = {}; cycle.self = cycle;
  const sparse = new Array(1);
  const custom = [1]; custom.extra = 2;
  const getter = Object.defineProperty({}, 'danger', { enumerable: true, get() { throw new Error('getter must not execute'); } });
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const symbol = { [Symbol('key')]: 1 };
  for (const invalid of [undefined, NaN, Infinity, -Infinity, 1n, () => 1, Symbol('x'), new Date(), new Map(), new Uint8Array(1), cycle, sparse, custom, getter, hidden, symbol, { nested: undefined }]) {
    assert.throws(() => canonicalJson(invalid), TypeError);
  }
});

test('EIP-712 digest agrees with ethers and preserves integers larger than Number.MAX_SAFE_INTEGER', async () => {
  const bundle = await fixture();
  assert.equal(receiptHash(bundle.domain, bundle.receipt), TypedDataEncoder.hash(bundle.domain, RECEIPT_TYPES, bundle.receipt));
  assert.equal(bundle.domain.chainId, '31337');
  assert.equal(domainFor(31337n, contract).chainId, '31337');
  assert.throws(() => domainFor(Number.MAX_SAFE_INTEGER + 1, contract), /safe integer/);
  assert.throws(() => receiptHash(bundle.domain, { ...bundle.receipt, nonce: 9007199254740993 }), /decimal string/);
  assert.throws(() => receiptHash(bundle.domain, { ...bundle.receipt, cost: String(1n << 256n) }), /uint256/);
});

test('Merkle proofs validate all leaves including odd promotion, duplicates, singleton and empty trees', () => {
  for (const count of [1, 2, 3, 5, 16, 31]) {
    const leaves = Array.from({ length: count }, (_, index) => id(`leaf-${index}`));
    const tree = merkleTree(leaves);
    leaves.forEach((leaf, index) => assert.equal(verifyMerkle(leaf, tree.proofs[index], tree.root), true));
    assert.equal(verifyMerkle(id('tampered'), tree.proofs[0], tree.root), false);
  }
  assert.deepEqual(merkleTree([]), { root: ZeroHash, proofs: [] });
  const singleton = merkleTree([id('only')]);
  assert.deepEqual(singleton, { root: id('only'), proofs: [[]] });
  const duplicate = merkleTree([id('repeat'), id('repeat'), id('other')]);
  assert.equal(verifyMerkle(id('repeat'), duplicate.proofs[1], duplicate.root), true);
  assert.equal(merkleTree([id('a'), id('b')]).root, merkleTree([id('b'), id('a')]).root);
  assert.throws(() => merkleTree(['0x01']));
  assert.throws(() => merkleTree(new Array(1)));
  assert.equal(verifyMerkle(id('only'), new Array(1), id('only')), false);
  assert.equal(verifyMerkle(id('only'), ['0x01'], id('only')), false);
  assert.equal(verifyMerkle(id('only'), {}, id('only')), false);
});

test('valid offline bundle verifies while explicitly declining to authenticate policy or on-chain anchoring', async () => {
  const result = verifyBundle(await fixture());
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.recoveredAgent, agent.address);
  assert.equal(result.anchoring, 'not_checked');
  assert.equal(result.policyAuthenticity, 'not_checked');
  assert.equal(result.checks.length, 12);
  assert.match(result.limitations.join(' '), /unauthenticated claim/);
  assert.match(result.limitations.join(' '), /revocation, expiry, cumulative spending and nonce/);
});

test('content mutations fail only their applicable commitments without trusting the output status', async () => {
  const bundle = await fixture();
  const inputTamper = structuredClone(bundle); inputTamper.input.revision = 'malicious';
  assert.deepEqual(failures(verifyBundle(inputTamper)), ['input-hash']);
  const outputTamper = structuredClone(bundle); outputTamper.output.tests = 43;
  assert.deepEqual(failures(verifyBundle(outputTamper)), ['output-hash']);
});

test('signature replacement and signed receipt edits fail signature verification', async () => {
  const bundle = await fixture();
  const replaced = structuredClone(bundle);
  replaced.signature = await other.signTypedData(bundle.domain, RECEIPT_TYPES, bundle.receipt);
  assert.ok(failures(verifyBundle(replaced)).includes('signature'));
  const changed = structuredClone(bundle); changed.receipt.cost = '251';
  const result = verifyBundle(changed);
  assert.equal(result.valid, false);
  assert.ok(failures(result).includes('signature'));
  assert.ok(failures(result).includes('anchor-membership'));
});

test('Merkle allowlist and receipt anchor mutations are rejected', async () => {
  const bundle = await fixture();
  const action = structuredClone(bundle); action.action.name = 'funds.withdraw';
  assert.ok(failures(verifyBundle(action)).includes('action'));
  const proof = structuredClone(bundle); proof.action.proof[0] = id('forged-action');
  assert.ok(failures(verifyBundle(proof)).includes('action-allowlist'));
  const anchor = structuredClone(bundle); anchor.anchor.proof[0] = id('forged-sibling');
  assert.ok(failures(verifyBundle(anchor)).includes('anchor-membership'));
  const root = structuredClone(bundle); root.anchor.root = id('forged-root');
  assert.ok(failures(verifyBundle(root)).includes('anchor-membership'));
});

test('included policy and domain inconsistencies fail without claiming policy authenticity', async () => {
  const bundle = await fixture();
  const changes = [
    [copy => { copy.policy.id = id('another-mandate'); }, 'mandate'],
    [copy => { copy.policy.agent = other.address; }, 'policy-agent'],
    [copy => { copy.policy.maxPerReceipt = '1'; }, 'cost-cap'],
    [copy => { copy.policy.budget = '1'; }, 'cost-cap'],
    [copy => { copy.policy.actionRoot = id('other-allowlist'); }, 'action-allowlist'],
    [copy => { copy.domain.chainId = '1'; }, 'domain-chain'],
    [copy => { copy.domain.verifyingContract = other.address; }, 'domain-contract'],
    [copy => { copy.anchor.chainId = '1'; }, 'domain-chain'],
    [copy => { copy.anchor.contractAddress = other.address; }, 'domain-contract'],
  ];
  for (const [change, failure] of changes) {
    const mutated = structuredClone(bundle); change(mutated);
    const result = verifyBundle(mutated);
    assert.equal(result.valid, false);
    assert.ok(failures(result).includes(failure), JSON.stringify(result));
  }
  const unauthenticated = structuredClone(bundle);
  unauthenticated.policy.owner = agent.address;
  unauthenticated.policy.expiresAt = '1';
  unauthenticated.anchor.transactionHash = id('unverified-transaction');
  const result = verifyBundle(unauthenticated);
  assert.equal(result.valid, true, 'Offline self-consistency cannot establish owner, live expiry or transaction inclusion');
  assert.equal(result.policyAuthenticity, 'not_checked');
  assert.equal(result.anchoring, 'not_checked');
});

test('malformed bundles, noncanonical integers and invalid addresses fail closed without throwing', async () => {
  const bundle = await fixture();
  const changes = [
    copy => { copy.schema = 'unknown'; },
    copy => { delete copy.input; },
    copy => { copy.receipt.cost = 250; },
    copy => { copy.receipt.nonce = '01'; },
    copy => { copy.receipt.nonce = '-1'; },
    copy => { copy.receipt.cost = '1e3'; },
    copy => { copy.receipt.cost = String(1n << 256n); },
    copy => { copy.policy.expiresAt = 2_000_000_000; },
    copy => { copy.policy.agent = 'not-an-address'; },
    copy => { copy.agent = '0x1234'; },
    copy => { copy.receipt.inputHash = '0x1234'; },
    copy => { copy.signature = '0x12'; },
    copy => { copy.domain.name = 'Other'; },
    copy => { copy.domain.salt = ZeroHash; },
    copy => { copy.domain.chainId = 1.5; },
    copy => { copy.anchor.blockNumber = -1; },
    copy => { copy.anchor.transactionHash = 'made-up'; },
    copy => { copy.anchor.proof = null; },
    copy => { copy.action.proof = [id('proof'), '0x1']; },
    copy => { copy.output.status = undefined; },
  ];
  for (const change of changes) {
    const mutated = structuredClone(bundle); change(mutated);
    const result = verifyBundle(mutated);
    assert.equal(result.valid, false);
    assert.deepEqual(failures(result), ['schema']);
  }
  for (const invalid of [null, undefined, [], 'bundle', 1]) assert.equal(verifyBundle(invalid).valid, false);
});
