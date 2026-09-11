# Presenting Prooflane in an interview

## A clear project pitch

“Prooflane is a policy-controlled tool gateway with portable execution receipts. An owner sets an agent's permitted actions and credit limits in a Solidity contract. The gateway runs deterministic tools and signs input/output commitments using EIP-712. Receipts are batched into Merkle roots, and a verifier checks their signatures, content integrity and contract acceptance. I built the UI, API, SQLite persistence, SDK, contracts and verification workflow, including replay and crash-recovery handling.”

State that this is a local portfolio prototype. The summarization tool is an extractive demonstration, credits are not money, the default chain is Anvil, and public testnet deployment is a next step. There is no x402 or ERC-8004 integration yet.

## Three truthful resume bullets

- Built Prooflane, an end-to-end tool execution and audit application with a responsive JavaScript interface, Node.js HTTP API, SQLite persistence, Node SDK and Solidity smart contracts.
- Implemented EIP-712 execution receipts, Merkle action allowlists and batch inclusion proofs, with contract-enforced agent authorization, exact nonces, per-call caps, cumulative credit budgets and owner revocation.
- Designed portable JSON evidence export, offline and chain-backed verification, idempotent request handling and chain-log reconciliation for recovery after a mined transaction is not yet reflected in the database.

Use these bullets only for the completed, verified version. Add measured results later with workload size and environment; do not invent throughput, gas savings, user counts or production impact. After benchmarking, a defensible sentence would have the form “Measured [result] for [workload] on [environment], using [comparison].”

## Five-minute demonstration

| Time | Action | Engineering point |
| --- | --- | --- |
| 0:00–0:40 | Open the dashboard and identify the local chain, contract and development accounts | Establish the actual deployment and the trust boundary |
| 0:40–1:20 | Create a mandate allowing digest and redact, with a 100-credit budget and a 30-credit per-call cap | Explain owner, agent, tool allowlist, cap and expiry |
| 1:20–2:00 | Execute a 20-credit digest and a 30-credit redact; attempt the disallowed summarize tool | Show useful behavior and deterministic policy rejection |
| 2:00–2:45 | Settle the accepted receipts and inspect the batch root and transaction | Show EIP-712 claims, consecutive nonces and atomic on-chain accounting |
| 2:45–3:40 | Export a JSON proof, verify it, change an output value in a copy and verify again | Distinguish readable content from its signed hash and prove tampering is detected |
| 3:40–4:20 | Compare offline integrity with verification against the expected chain and contract | Explain why a bundle cannot authenticate its own root or copied policy |
| 4:20–5:00 | Show the Bitcoin lab or its tested example; describe the database/chain crash window | Connect syllabus concepts to systems engineering and name the main limitations |

Keep synthetic documents ready. Rehearse the exact interface and commands from the README rather than depending on network access or a faucet during a live interview. If time is short, prefer the tamper-and-verify sequence over listing technologies.

## Questions worth preparing

**Why not just use PostgreSQL or an append-only log?** A conventional database is the right operational store. Signatures and transparency logs may be sufficient when an organization is trusted. The contract adds a separately observed acceptance rule and shared commitment when counterparties should not trust one database administrator. This has deployment and verification costs; the design uses off-chain content and compact on-chain commitments.

**What does a verified receipt actually prove?** It binds specified bytes to the agent's key and, with online verification, establishes acceptance by the configured contract. It does not prove the tool ran honestly, its output was correct, every action was logged or the claimed cost equals a real payment. The gateway's fixed tariffs and tool behavior remain separate trust assumptions.

**Why both SHA-256 and Keccak-256?** SHA-256 hashes canonical content and connects directly to the syllabus. Ethereum typed-data digests and Merkle pair hashing use Keccak-256. The contract and client share exact definitions. Ethereum Keccak-256 is not interchangeable with standardized SHA3-256.

**How are replay and concurrent overspending prevented?** The contract accepts the exact next nonce for each mandate and checks cumulative costs atomically. Before settlement, the gateway includes pending reservations in its remaining budget and serializes mutation decisions. That queue coordinates one process; multiple workers would require durable locking or transactional reservation ownership.

**What happens after the chain mines a batch and the server crashes?** There is a gap between chain acceptance and the SQLite update. Replaying contract events reconciles accepted batches after restart. This is a recovery protocol across two systems, not a single atomic distributed commit. External side effects would need further idempotency or compensation.

**Why are batches capped at 32?** It is an explicit bounded-work choice that limits signature/proof verification per call and keeps demonstrations predictable. It is not a claim that 32 is globally optimal. Benchmark batch size, gas per receipt, pending latency and failure behavior before changing it.

**Does the Merkle root prove order or completeness?** Its proof establishes membership. Sorted sibling hashing does not encode a leaf position. Contract nonce checks impose submission order, and previous roots link accepted batches; none of this proves that an untrusted agent reported every real-world action.

**Can someone front-run a batch?** Settlement is permissionless, so another relayer may submit the same authorized data. They cannot change the signed claim without invalidating the signature, and a second submission fails nonce checks. Public mandate ID creation has a different risk; unpredictable owner-scoped IDs mitigate squatting, while stronger owner binding belongs in a production revision.

**Why no NFT, token or multiple chains?** The product requirement is verifiable evidence under a policy. None of those features improves that requirement in this prototype. A clear trust model and tested failure handling provide a stronger engineering argument than unused infrastructure.

**How would this become useful for AI agents?** Add a genuine MCP or other agent-tool adapter behind the same gateway, preserving strict authorization and evidence generation. If paid APIs are a requirement, implement and test a real payment protocol adapter with separate payment proofs. Do not present extractive summarization or audit credits as those integrations.

## Hiring signals to emphasize

The strongest discussion is about choices and evidence: strict schemas, cross-language hash agreement, state-machine invariants, database/chain consistency, portable verification and a usable demonstration. Be ready to trace one receipt from input to signature to contract event, explain a failed test and its fix, and describe a simpler alternative architecture.

A project can support an internship or graduate application by making these skills concrete. It does not guarantee an offer. Interview readiness also requires explaining the implementation independently, core computer-science preparation and evidence that another person can run the repository.
