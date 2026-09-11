# Research, precedents and positioning

Research checked on 11 September 2026. This document explains the project's design context; it does not claim that every referenced system is integrated.

Prooflane explores **portable evidence for policy-controlled agent/tool actions**. Its distinguishing portfolio workflow combines an on-chain mandate, signed execution claims, Merkle batch acceptance, exportable proofs and a tampering demonstration. Similar ideas already exist in agent payments, transparency logs and decentralized agent registries. No exhaustive prior-art search has established novelty, and the project should not be described as the first or only implementation.

## Standards and existing systems

| Primary source | What it establishes | Relationship to Prooflane |
| --- | --- | --- |
| [EIP-712: Typed structured data hashing and signing](https://eips.ethereum.org/EIPS/eip-712) | A standard representation for typed Ethereum signatures, including domain separation. Applications must define replay and frontrunning behavior | Implemented for execution receipts. Exact per-mandate nonces supply replay protection; policy creation is an on-chain owner transaction |
| [OpenZeppelin cryptography documentation](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography) | Established signature and Merkle verification patterns, sorted-pair requirements and warnings about ambiguous 64-byte leaf preimages | A reference for reviewing the implementation. Prooflane uses 32-byte action hashes and EIP-712 receipt digests, and documents its odd-node promotion rule; it does not claim to use OpenZeppelin's standard tree package |
| [Coinbase x402 documentation](https://docs.cdp.coinbase.com/x402/welcome) | HTTP payment flows for APIs, digital services and programmatic clients including AI agents | Supports the relevance of policy-limited machine actions. Prooflane currently accounts for synthetic credits and does not implement x402 or settle payments |
| [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) | A draft specification for agent identity, reputation and validation; registration alone does not establish benign or functioning capabilities | A possible future identity link. The prototype neither implements these registries nor claims ERC-8004 compatibility |
| [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) | A practical transparency-log precedent for signed metadata, append-only records and independent inclusion/consistency verification | A serious alternative design. Prooflane adds contract-enforced mandate accounting and a chain anchor; a trusted or witnessed log may be preferable in other settings |
| [Ethereum: optimistic rollups](https://ethereum.org/developers/docs/scaling/optimistic-rollups/) | EVM-compatible scaling, shared settlement, transaction batching and distinct finality/trust considerations | Relevant to a future testnet/L2 deployment. The default Anvil chain is not a rollup, and receipt batching does not implement a rollup |

## Where blockchain adds value

The following is a design inference from these mechanisms, not a claim that blockchain is always necessary. If counterparties already share trusted operational infrastructure, a database with signatures and a monitored transparency log may satisfy the requirement. If they need a commonly observable acceptance rule without trusting one application administrator, an on-chain mandate can independently enforce signer, action and credit constraints while preserving a shared accepted-root history.

Batching amortizes transaction overhead and yields compact per-receipt inclusion proofs, but it also adds settlement delay and a pending-state recovery problem. Full input/output content remains off chain to avoid public disclosure and excessive storage. A commitment does not guarantee that the content will remain available; users need the exported evidence or a separately maintained data service.

## What the receipt can and cannot establish

A signature authenticates a claim to a key. A content commitment detects edits. A Merkle proof establishes membership in a root. Reading the expected contract and matching transaction event establishes that the contract accepted that root under its rules. Each step adds a specific check; none establishes the real-world truth of an output or the completeness of an agent's reported activity.

This distinction matters for AI. A signed fabricated answer is still fabricated. A compromised authorized agent can produce misleading claims within its credit limits. Stronger execution assurance would require a separately justified mechanism, such as independent recomputation, attested execution or an appropriate proof system, with its own assumptions and costs.

## Honest terminology

| Prefer | Avoid |
| --- | --- |
| Policy-controlled tool gateway and verifiable receipt prototype | Trustless AI or guaranteed-correct AI |
| Contract-enforced credit accounting | Autonomous cryptocurrency payments, unless implemented |
| Local EVM deployment; testnet workflow provided | Public deployment or production readiness without evidence |
| SHA-256 content hashes, EIP-712 signatures, Merkle inclusion proofs | Zero-knowledge proofs or encryption when neither is used |
| Ethereum-compatible application | Implemented Ethereum consensus |
| Distinctive integration and demonstrated engineering tradeoffs | First-ever blockchain project or guaranteed hiring outcomes |

## Research questions for a stronger next version

1. Which real dispute requires independent verification: a tool invocation, a bill, a policy decision or the returned artifact?
2. Who trusts the signing key, and how are its owner, rotation and revocation authenticated?
3. When is a gateway's attestation sufficient, and when must the tool supply its own evidence?
4. How much delay will users accept in exchange for lower gas per receipt?
5. Does a public chain materially improve the requirement compared with a monitored transparency log?

Answering these questions with one real user workflow is more valuable than adding tokens, chains or standards without a demonstrated need.
