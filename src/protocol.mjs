import { TypedDataEncoder, concat, getAddress, id, isHexString, keccak256, sha256, toUtf8Bytes, verifyTypedData, ZeroHash } from 'ethers';

/** The same field order and names are compiled into Prooflane's Solidity verifier. */
export const RECEIPT_TYPES = Object.freeze({
  Receipt: Object.freeze([
    { name: 'mandateId', type: 'bytes32' },
    { name: 'actionHash', type: 'bytes32' },
    { name: 'inputHash', type: 'bytes32' },
    { name: 'outputHash', type: 'bytes32' },
    { name: 'cost', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ].map(Object.freeze)),
});

const UINT256_MAX = (1n << 256n) - 1n;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function assert(condition, message) { if (!condition) throw new TypeError(message); }
function bytes32(value, label = 'hash') {
  assert(typeof value === 'string' && isHexString(value, 32), `${label} must be a 32-byte hex string`);
  return value.toLowerCase();
}
function address(value, label = 'address') {
  assert(typeof value === 'string', `${label} must be an Ethereum address`);
  try { return getAddress(value); } catch { throw new TypeError(`${label} must be a valid Ethereum address`); }
}
function uintString(value, label = 'integer', positive = false) {
  assert(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), `${label} must be a canonical decimal string`);
  assert(value.length <= 78, `${label} exceeds uint256`);
  const integer = BigInt(value);
  assert(integer <= UINT256_MAX && (!positive || integer > 0n), `${label} is outside the allowed uint256 range`);
  return integer;
}
function chainString(value, label = 'chainId') {
  if (typeof value === 'number') assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  assert(['string', 'bigint', 'number'].includes(typeof value), `${label} must be a positive integer`);
  const serialized = String(value);
  uintString(serialized, label, true);
  return serialized;
}
function fields(value, names, label) {
  assert(isPlain(value), `${label} must be a plain object`);
  for (const name of names) assert(hasOwn(value, name), `${label}.${name} is required`);
}

/** JSON-safe chain ID. Receipt and policy integers always remain decimal strings. */
export function domainFor(chainId, verifyingContract) {
  return { name: 'Prooflane', version: '1', chainId: chainString(chainId), verifyingContract: address(verifyingContract) };
}

/**
 * Deterministic JSON: sort object keys by UTF-16 code units and use ECMAScript
 * JSON primitive serialization. Arrays retain order. No Unicode normalization.
 * Reject lossy JSON values, accessors, cycles, sparse arrays and exotic objects.
 */
export function canonicalJson(value) {
  const active = new WeakSet();
  const encode = (item, depth = 0) => {
    assert(depth <= 128, 'JSON exceeds maximum nesting depth');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      assert(Number.isFinite(item), 'JSON numbers must be finite');
      return JSON.stringify(item);
    }
    assert(typeof item === 'object', 'Value is not representable as plain JSON');
    assert(!active.has(item), 'JSON cannot contain cycles');
    assert(Object.getOwnPropertySymbols(item).length === 0, 'JSON cannot contain symbol keys');
    active.add(item);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Array.isArray(item)) {
        assert(Object.getPrototypeOf(item) === Array.prototype, 'JSON arrays must use the standard Array prototype');
        assert(Object.keys(descriptors).length === item.length + 1, 'JSON arrays cannot be sparse or contain custom properties');
        const encoded = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = descriptors[i];
          assert(descriptor && hasOwn(descriptor, 'value') && descriptor.enumerable, 'JSON arrays require ordinary indexed values');
          encoded.push(encode(descriptor.value, depth + 1));
        }
        return `[${encoded.join(',')}]`;
      }
      assert(isPlain(item), 'JSON objects must be plain objects');
      return `{${Object.keys(descriptors).sort().map(key => {
        const descriptor = descriptors[key];
        assert(descriptor.enumerable && hasOwn(descriptor, 'value'), 'JSON objects cannot contain accessors or hidden properties');
        return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    } finally { active.delete(item); }
  };
  return encode(value);
}

export function contentHash(value) { return sha256(toUtf8Bytes(canonicalJson(value))); }
export function actionHash(tool) {
  assert(typeof tool === 'string' && tool.length > 0 && tool.length <= 256, 'Action name must contain 1 to 256 characters');
  return id(tool);
}

function validateDomain(domain) {
  fields(domain, ['name', 'version', 'chainId', 'verifyingContract'], 'domain');
  assert(domain.name === 'Prooflane' && domain.version === '1', 'Unsupported EIP-712 domain');
  assert(Object.keys(domain).length === 4, 'Domain has unsupported fields');
  return domainFor(domain.chainId, domain.verifyingContract);
}
function validateReceipt(receipt) {
  fields(receipt, RECEIPT_TYPES.Receipt.map(field => field.name), 'receipt');
  assert(Object.keys(receipt).length === 6, 'Receipt has unsupported fields');
  for (const key of ['mandateId', 'actionHash', 'inputHash', 'outputHash']) bytes32(receipt[key], `receipt.${key}`);
  uintString(receipt.cost, 'receipt.cost');
  uintString(receipt.nonce, 'receipt.nonce');
  return receipt;
}
export function receiptHash(domain, receipt) {
  return TypedDataEncoder.hash(validateDomain(domain), RECEIPT_TYPES, validateReceipt(receipt));
}

function pairHash(left, right) {
  const pair = [bytes32(left), bytes32(right)].sort();
  return keccak256(concat(pair));
}

/** Leaves retain their input order; pairs are sorted. An unpaired node is promoted unchanged. */
export function merkleTree(leaves) {
  assert(Array.isArray(leaves), 'Merkle leaves must be an array');
  const normalized = Array.from(leaves, leaf => bytes32(leaf, 'leaf'));
  if (!normalized.length) return { root: ZeroHash, proofs: [] };
  const levels = [normalized];
  while (levels.at(-1).length > 1) {
    const previous = levels.at(-1);
    const next = [];
    for (let i = 0; i < previous.length; i += 2) {
      next.push(i + 1 < previous.length ? pairHash(previous[i], previous[i + 1]) : previous[i]);
    }
    levels.push(next);
  }
  const proofs = normalized.map((_, index) => {
    const proof = [];
    for (let level = 0, position = index; level < levels.length - 1; level++, position = Math.floor(position / 2)) {
      const sibling = position % 2 ? position - 1 : position + 1;
      if (sibling < levels[level].length) proof.push(levels[level][sibling]);
    }
    return proof;
  });
  return { root: levels.at(-1)[0], proofs };
}

export function verifyMerkle(leaf, proof, root) {
  try {
    assert(Array.isArray(proof) && proof.length <= 256, 'Merkle proof must be an array of at most 256 hashes');
    let result = bytes32(leaf, 'leaf');
    for (const sibling of proof) result = pairHash(result, sibling);
    return result === bytes32(root, 'root');
  } catch { return false; }
}

/**
 * Verify self-consistency of a portable receipt bundle without an RPC provider.
 * `valid` DOES NOT establish chain inclusion or authentic/live policy state.
 * A relying party must read contract events/state and evaluate its trust policy.
 */
export function verifyBundle(bundle) {
  const result = {
    valid: false,
    checks: [],
    anchoring: 'not_checked',
    policyAuthenticity: 'not_checked',
    limitations: [
      'Offline checks prove bundle consistency only. The included policy is an unauthenticated claim until compared with on-chain state.',
      'An RPC check must confirm the claimed root, transaction, block and contract on the expected chain, including finality.',
      'Current mandate revocation, expiry, cumulative spending and nonce consumption require on-chain state. Offline membership does not prove execution quality.',
    ],
  };
  const check = (name, run, detail) => {
    try {
      const valid = run() !== false;
      result.checks.push({ name, valid, detail: valid ? detail : `${detail} — mismatch` });
      return valid;
    } catch (error) {
      result.checks.push({ name, valid: false, detail: error instanceof Error ? error.message : 'Invalid value' });
      return false;
    }
  };
  const shapeValid = check('schema', () => {
    canonicalJson(bundle);
    fields(bundle, ['schema', 'domain', 'receipt', 'signature', 'agent', 'policy', 'action', 'input', 'output', 'anchor'], 'bundle');
    assert(bundle.schema === 'prooflane.receipt.v1', 'Unsupported receipt bundle schema');
    validateDomain(bundle.domain);
    validateReceipt(bundle.receipt);
    address(bundle.agent, 'agent');
    assert(typeof bundle.signature === 'string' && (isHexString(bundle.signature, 64) || isHexString(bundle.signature, 65)), 'signature must be a 64- or 65-byte hex signature');
    fields(bundle.policy, ['id', 'owner', 'agent', 'actionRoot', 'budget', 'maxPerReceipt', 'expiresAt'], 'policy');
    bytes32(bundle.policy.id, 'policy.id');
    address(bundle.policy.owner, 'policy.owner');
    address(bundle.policy.agent, 'policy.agent');
    bytes32(bundle.policy.actionRoot, 'policy.actionRoot');
    uintString(bundle.policy.budget, 'policy.budget');
    uintString(bundle.policy.maxPerReceipt, 'policy.maxPerReceipt');
    uintString(bundle.policy.expiresAt, 'policy.expiresAt', true);
    fields(bundle.action, ['name', 'proof'], 'action');
    actionHash(bundle.action.name);
    fields(bundle.anchor, ['root', 'proof', 'transactionHash', 'blockNumber', 'chainId', 'contractAddress'], 'anchor');
    bytes32(bundle.anchor.root, 'anchor.root');
    bytes32(bundle.anchor.transactionHash, 'anchor.transactionHash');
    // Block height is public metadata: safe integer numbers or decimal strings accepted.
    const blockNumber = bundle.anchor.blockNumber;
    if (typeof blockNumber === 'number') assert(Number.isSafeInteger(blockNumber) && blockNumber >= 0, 'anchor.blockNumber must be a safe nonnegative integer');
    else uintString(blockNumber, 'anchor.blockNumber');
    chainString(bundle.anchor.chainId, 'anchor.chainId');
    address(bundle.anchor.contractAddress, 'anchor.contractAddress');
    for (const proof of [bundle.action.proof, bundle.anchor.proof]) {
      assert(Array.isArray(proof) && proof.length <= 256, 'Proof must be an array of at most 256 hashes');
      proof.forEach(hash => bytes32(hash, 'proof element'));
    }
    return true;
  }, 'Bundle schema and primitive types are well formed');
  if (!shapeValid) return result;

  const { domain, receipt, policy, agent, action, anchor } = bundle;
  result.receiptDigest = receiptHash(domain, receipt);
  check('signature', () => {
    result.recoveredAgent = verifyTypedData(domain, RECEIPT_TYPES, receipt, bundle.signature);
    return result.recoveredAgent === address(agent);
  }, 'EIP-712 signature recovers the declared agent');
  check('mandate', () => bytes32(receipt.mandateId) === bytes32(policy.id), 'Signed mandate ID matches the included policy claim');
  check('policy-agent', () => address(policy.agent) === address(agent), 'Included policy names the declared agent');
  check('action', () => bytes32(receipt.actionHash) === actionHash(action.name), 'Action name matches the signed action hash');
  check('action-allowlist', () => verifyMerkle(receipt.actionHash, action.proof, policy.actionRoot), 'Action belongs to the included policy allowlist');
  check('input-hash', () => bytes32(receipt.inputHash) === contentHash(bundle.input), 'Input hashes to the signed content commitment');
  check('output-hash', () => bytes32(receipt.outputHash) === contentHash(bundle.output), 'Output hashes to the signed content commitment');
  check('cost-cap', () => BigInt(receipt.cost) <= BigInt(policy.maxPerReceipt) && BigInt(receipt.cost) <= BigInt(policy.budget), 'Cost fits the included per-receipt cap and total budget; prior spend is not checked');
  check('anchor-membership', () => verifyMerkle(result.receiptDigest, anchor.proof, anchor.root), 'Signed receipt digest belongs to the claimed anchor root');
  check('domain-chain', () => chainString(domain.chainId) === chainString(anchor.chainId), 'Signing domain matches the claimed anchor chain');
  check('domain-contract', () => address(domain.verifyingContract) === address(anchor.contractAddress), 'Signing domain matches the claimed anchor contract');
  result.valid = result.checks.every(item => item.valid);
  return result;
}
