# Security scope

Prooflane is a **localhost portfolio prototype**, not a production agent gateway, audited contract, payment service or secure key vault. It does not transfer assets. Use synthetic inputs and publicly known development accounts only.

## Guarantees with their assumptions

- The contract checks canonical ECDSA signatures from the configured EOA agent, EIP-712 domain binding, tool membership, consecutive nonces, expiry, revocation and credit limits. The whole batch reverts on failure.
- Offline verification detects inconsistent signed content. Authentic policy and chain inclusion require the expected contract and chain from an independent trusted source.
- On-chain inclusion does not prove truthful execution, accurate price, correctness of output or completeness of logging. An authorized malicious agent can sign false claims within the limits.
- The gateway reserves pending credits atomically within one process. SQLite constraints and transactions protect local records. These controls do not coordinate several service instances.

## Local threat boundary

Both HTTP and EVM RPC listeners bind to `127.0.0.1`. HTTP rejects unexpected Host/Origin headers and requires a custom mutation header plus JSON. CORS is not enabled. The header is not a secret and is not authentication; local clients have administrative access. The EVM RPC has powerful development methods and unlocked, publicly known keys. Never bind either service to a public interface or forward these ports.

Mandate identifiers contain a random UUID and owner identity hash. This reduces predictable-ID squatting, but the Solidity create function is not cryptographically owner-namespaced. Contract-wallet signatures (ERC-1271), key rotation, tenant isolation, rate limiting and external authorization are not implemented.

Inputs and outputs are stored in plaintext locally and included in exported bundles. Hashing is not encryption. Pattern redaction is incomplete; predictable secrets can be guessed from public hashes. The contract stores hashes and receipt metadata rather than full content. Metadata can still reveal activity.

The content canonicalization is a documented project format, not full RFC 8785. Only the six Receipt fields and EIP-712 domain are signed. Labels, request IDs and attempt timestamps are local metadata; policy and transaction claims are checked separately. The service and offline verifier reject malformed data and oversized inputs, and the UI escapes rendered record values.

## Recovery and retention

The chain and SQLite cannot share one atomic transaction. Event replay reconciles a batch mined before local indexing completes. Keep their data together. Local-chain persistence behavior is documented in the runtime and tested on graceful restart; it is not a disk-failure guarantee. Deleting a local evidence file loses its content even when a root remains.

Actual external side effects would require their own idempotency/compensation and durable reservation strategy. Revocation can race with work already in progress: settlement after revocation fails, even if the gateway ran the tool earlier. Historical accepted proofs remain valid after revocation/expiry.

## Dependencies and release checks

Use the pinned lockfile and run `npm audit` when reproducing the project; advisory results change over time. A passing registry audit does not inspect the Rust internals of a native development-node binary or establish contract security. The automated suite exercises concrete attacks and integration behavior; it is not a substitute for an independent security review.

Before any shared deployment, replace development identities, add authentication/tenant controls, secure secrets, design external-action consistency, enforce a public-chain confirmation/reorganization policy, use a production RPC provider and commission a review appropriate to the workload. The optional testnet deployment script publishes only the contract and deliberately refuses mainnet IDs.

For a suspected issue, reproduce it using synthetic data and report the affected guarantee and a minimal test. Do not submit funded keys, private documents or personal data in public issues.
