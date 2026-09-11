# Prooflane receipt protocol v1

Prooflane commits an agent's action, input, output, claimed cost and nonce to an EIP-712 signature. The signature authenticates the signer and bytes; it does not establish that an action really ran or that the output is correct. A content hash detects edits; a receipt anchor proves inclusion only after an independent reader checks the relevant chain.

## Module interface

Import the named exports from `src/protocol.mjs`:

| Export | Contract |
| --- | --- |
| `RECEIPT_TYPES` | EIP-712 `Receipt` field definition, ordered as below. |
| `domainFor(chainId, address)` | `{name:'Prooflane',version:'1',chainId:decimalString,verifyingContract:checksumAddress}`. Accepts a positive safe number, bigint, or canonical decimal chain ID. |
| `canonicalJson(value)` | Returns deterministic JSON text, or throws on unsupported/lossy values. |
| `contentHash(value)` | `SHA256(UTF8(canonicalJson(value)))`, returned as a `0x`-prefixed bytes32. |
| `actionHash(name)` | `keccak256(UTF8(name))`, using `ethers.id`. Names are case sensitive and contain 1–256 characters. |
| `receiptHash(domain, receipt)` | Full EIP-712 digest, including the domain separator. |
| `merkleTree(leaves)` | `{root, proofs}`, with proofs in original leaf order. |
| `verifyMerkle(leaf, proof, root)` | Boolean. Malformed inputs return false. |
| `verifyBundle(bundle)` | Synchronous offline verifier returning the structured result below. |

`RECEIPT_TYPES` is exactly:

```text
Receipt(bytes32 mandateId,bytes32 actionHash,bytes32 inputHash,bytes32 outputHash,uint256 cost,uint256 nonce)
```

Sign with `wallet.signTypedData(domain, RECEIPT_TYPES, receipt)`. Receipt `cost` and `nonce` must be canonical decimal strings, including for small values: `"0"`, `"250"`, etc. Negative values, leading zeros, exponents, floating-point values, numbers and values outside uint256 are rejected. Never convert money or nonces through JavaScript `Number`.

## Canonical content

Canonicalization recursively sorts object keys by UTF-16 code units, preserves array order and uses ECMAScript JSON primitive serialization. There is no Unicode normalization. Finite JSON numbers are allowed for ordinary content; `-0` serializes as `0`. Monetary quantities belong in decimal strings.

Undefined, bigint, symbols, functions, NaN, infinities, cycles, exotic objects, accessors, hidden properties, sparse arrays and custom array properties are rejected. Maximum nesting is 128 levels. Plain objects with a null prototype are accepted. Do not describe this implementation as a complete RFC 8785 implementation.

Input and output are stored off chain, with only their hashes committed. Publishing the portable bundle itself publishes its input and output; the application should use synthetic or redacted demo content.

## Merkle construction

Use 32-byte leaf hashes. Preserve input leaf order. For each pair, sort its two bytes32 values in ascending byte order, then compute `keccak256(left || right)`. Promote an unmatched final node unchanged. A singleton root equals its leaf and its proof is empty. The empty tree has the all-zero bytes32 root and no proofs.

Action allowlist leaves are `actionHash(actionName)`. Anchor leaves are the full `receiptHash(domain, receipt)`. Proofs contain sibling hashes from leaf to root; no positional bits are needed. `verifyMerkle` is compatible with a Solidity sorted-pair Merkle verifier. Duplicate leaves are supported; enforce nonce uniqueness separately on chain. A proof is capped at 256 siblings.

The Bitcoin lab deliberately uses a different tree: double SHA-256 with odd-node duplication, to make the distinction visible.

## Portable bundle

```json
{
  "schema": "prooflane.receipt.v1",
  "domain": {
    "name": "Prooflane",
    "version": "1",
    "chainId": "31337",
    "verifyingContract": "0x…20 bytes…"
  },
  "receipt": {
    "mandateId": "0x…32 bytes…",
    "actionHash": "0x…32 bytes…",
    "inputHash": "0x…32 bytes…",
    "outputHash": "0x…32 bytes…",
    "cost": "250",
    "nonce": "0"
  },
  "signature": "0x…64 or 65 bytes…",
  "agent": "0x…20 bytes…",
  "policy": {
    "id": "0x…32 bytes…",
    "owner": "0x…20 bytes…",
    "agent": "0x…20 bytes…",
    "actionRoot": "0x…32 bytes…",
    "budget": "1000000",
    "maxPerReceipt": "10000",
    "expiresAt": "2000000000"
  },
  "action": { "name": "ci.run", "proof": ["0x…32 bytes…"] },
  "input": { "revision": "abc123" },
  "output": { "status": "passed" },
  "anchor": {
    "root": "0x…32 bytes…",
    "proof": ["0x…32 bytes…"],
    "transactionHash": "0x…32 bytes…",
    "blockNumber": 123,
    "chainId": "31337",
    "contractAddress": "0x…20 bytes…"
  }
}
```

Policy budget, cap and expiry are canonical uint256 strings; expiry is positive. Anchor block number accepts a nonnegative safe integer or canonical uint256 string. Domain and anchor chain IDs accept positive safe integers or canonical uint256 strings in serialized bundles. `domainFor` additionally accepts bigint, but bundles themselves must be plain JSON.

The offline result is:

```js
{
  valid: true, // ALL OFFLINE CONSISTENCY CHECKS passed; not a complete trust decision
  checks: [{ name: 'signature', valid: true, detail: '…' } /* … */],
  receiptDigest: '0x…',
  recoveredAgent: '0x…',
  anchoring: 'not_checked',
  policyAuthenticity: 'not_checked',
  limitations: ['…']
}
```

Check names: `schema`, `signature`, `mandate`, `policy-agent`, `action`, `action-allowlist`, `input-hash`, `output-hash`, `cost-cap`, `anchor-membership`, `domain-chain`, `domain-contract`. Malformed schemas fail closed and return only the failed schema check. A signature recovery error becomes a failed signature check. `receiptDigest` is absent when schema validation fails; `recoveredAgent` is absent when recovery fails.

## Online verification is mandatory for an anchoring claim

An independent online verifier must pin an expected chain ID and trusted contract address, rather than accepting these trust roots only from the untrusted bundle. It must then:

1. Read the transaction receipt through its configured RPC. Require successful execution, a matching block number/hash and the expected contract's anchor event containing the claimed root. Apply a stated finality policy; a single local development block is not public-chain finality.
2. Read the mandate from that trusted contract and compare owner, agent, action root, original budget, per-receipt cap and expiry with the included claim. The portable policy object is not owner signed and cannot authenticate itself.
3. Check nonce consumption and spending according to the contract's accounting. A cost that fits the original budget says nothing about prior spending. Never replay an accepted nonce as a second authorization.
4. Distinguish acceptance at the anchor block from current mandate state. Later expiry or revocation can block future actions without invalidating a receipt accepted earlier. If reporting historical eligibility, read state/events at the relevant block and define the result accordingly.

Display separate labels for **offline integrity**, **confirmed chain inclusion**, and **current policy status**. Avoid presenting `verifyBundle.valid` alone as “verified on chain.” The signature proves an agent's claim, not the tool output's truth, source identity, absence of malware, or real-world payment.

## Educational Bitcoin lab

Run `node labs/bitcoin.mjs`. It prints a deterministic proof-of-work example, UTXO payment with change and a fee, a rejected double spend, and a rejected tampered block. Seven `node:test` cases cover a SHA-256d known vector, atomic UTXO transitions, duplicate/spent/missing inputs, inflation and malformed amounts, proof-of-work commitments, and odd-node Merkle duplication.

This is an educational model, not a Bitcoin implementation. It omits script/signature authorization, real wire serialization, byte-order rules, peer networking, coinbase maturity, difficulty retargeting and chain selection. Owners are labels. It cannot handle real bitcoin.
