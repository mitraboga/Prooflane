# Security scope

Prooflane is a **portfolio demo** with local and public-testnet configurations. It is not an audited contract, payment service or secure key vault. The contract transfers no assets; the public owner spends faucet ETH on transaction gas. Use synthetic inputs. Public mode requires fresh, separate testnet keys; publicly known development keys are restricted to local mode.

## Guarantees with their assumptions

- The contract checks canonical ECDSA signatures from the configured EOA agent, EIP-712 domain binding, tool membership, consecutive nonces, expiry, revocation and credit limits. The whole batch reverts on failure.
- Offline verification detects inconsistent signed content. Authentic policy and chain inclusion require the expected contract and chain from an independent trusted source.
- On-chain inclusion does not prove truthful execution, accurate price, correctness of output or completeness of logging. An authorized malicious agent can sign false claims within the limits.
- A process queue and PostgreSQL transaction-level advisory lock serialize public mutations, pending reservations and owner nonces across instances sharing one database and signing identity. Local SQLite uses a process queue and transactions.

## Public demo boundary

Public mode requires HTTPS origin configuration, persistent PostgreSQL, a session secret, distinct owner/agent keys and an existing Base Sepolia contract. Startup validates chain 84532, exact runtime bytecode, creation block and the database deployment fingerprint. It never falls back to SQLite or starts an unlocked development RPC.

Visitors receive 30-day HMAC-signed, Secure, HttpOnly, SameSite=Lax cookies. Object reads/writes and exports are scoped to the visitor; request IDs are namespaced. Sessions are not verified identities, and clearing a cookie loses guest access. The server sponsors gas and signs for all visitors. Daily/global transaction and execution limits persist in PostgreSQL; HTTP limits are per process and reset on restart. See [exact limits](docs/public-deployment.md#limits-and-operations).

Secrets belong in Render environment settings. The Windows operator helper encrypts testnet keys for the current Windows user and prints addresses only; explicit copy actions put keys on the clipboard for direct transfer to Render. Clear the clipboard afterward. Do not commit secrets or use real-money wallets. Rotation is not automatic: changing a deployment or signing identity against the same archive fails startup.

## Local threat boundary

Both HTTP and EVM RPC listeners bind to `127.0.0.1`. HTTP rejects unexpected Host/Origin headers and requires a custom mutation header plus JSON. CORS is not enabled. The header is not a secret and is not authentication; local clients have administrative access. The EVM RPC has powerful development methods and unlocked, publicly known keys. Never bind either service to a public interface or forward these ports.

Mandate identifiers contain a random UUID and owner identity hash. This reduces predictable-ID squatting, but Solidity creation is not cryptographically owner-namespaced. ERC-1271 signatures, external account authorization, organization roles and key rotation are not implemented. Public guest isolation and demo limits do not substitute for those features.

Inputs and outputs are stored in the configured database without application-level content encryption and included in exported bundles. Public database connections verify TLS. Hashing is not encryption. Redaction is incomplete; predictable secrets can be guessed from public hashes. The contract stores commitments rather than full documents, but receipt metadata, signatures and hashes appear in public transaction calldata.

The content canonicalization is a documented project format, not full RFC 8785. Only the six Receipt fields and EIP-712 domain are signed. Labels, request IDs and attempt timestamps are local metadata; policy and transaction claims are checked separately. The service and offline verifier reject malformed data and oversized inputs, and the UI escapes rendered record values.

## Recovery and retention

The database and chain cannot share one atomic transaction. Public mode commits exact signed transaction bytes before broadcast and recovers uncertain sends by their saved hash; new mutations wait until reconciliation. Bounded event scans persist their cursor. Confirmed journal entries clear raw transaction bytes. Signed bytes are not private keys, but the journal remains server-side.

Settlement and verification check canonical block hashes and configured confirmation depth. Three Base Sepolia L2 confirmations are not Ethereum settlement finality. Full database rollback after a deep reorganization, automatic replacement of stuck transactions, backup and retention are operator responsibilities. A missing/mismatching event fails verification. Local mode retains Anvil checkpoints; a crash before checkpointing may lose recent chain changes. Missing off-chain content cannot be reconstructed from a root.

Actual external side effects would require their own idempotency/compensation and durable reservation strategy. Revocation can race with work already in progress: settlement after revocation fails, even if the gateway ran the tool earlier. Historical accepted proofs remain valid after revocation/expiry.

## Dependencies and release checks

Use the pinned lockfile and run `npm audit` when reproducing the project; advisory results change over time. A passing registry audit does not inspect the Rust internals of a native development-node binary or establish contract security. The automated suite exercises concrete attacks and integration behavior; it is not a substitute for an independent security review.

Before relying on this demo for sensitive or financially consequential work, add verified identities, external signing and rotation, backup/retention, full reorganization recovery, external-action consistency and independent review. The deployment script and public runtime refuse mainnet. A passing demo is not a production-readiness claim.

For a suspected issue, reproduce it using synthetic data and report the affected guarantee and a minimal test. Do not submit funded keys, private documents or personal data in public issues.
