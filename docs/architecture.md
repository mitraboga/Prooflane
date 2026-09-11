# Architecture and trust model

Prooflane is a local portfolio prototype for policy-controlled tool execution and independently checkable execution receipts. An owner publishes a mandate, a gateway applies it before running a tool, and an authorized agent signs a claim about the action. A Solidity contract accepts batches only when the signatures, allowed actions, nonces and credit limits satisfy the mandate.

The useful result is a portable evidence bundle: another party can detect content edits, recover the signing address and check that the receipt belongs to a batch accepted by the configured contract. This does not prove that an AI reasoned correctly or that a tool reported the truth.

## Components

| Component | Responsibility | Deliberate boundary |
| --- | --- | --- |
| Responsive browser UI | Create mandates, execute sample tools, inspect receipts and verification results | Vanilla JavaScript; the local gateway operates the demonstration keys |
| Node.js 24 HTTP API | Validate requests, execute deterministic tools, sign receipts, serialize mutations and serve the UI | One local service process; no production identity or tenant isolation |
| SQLite in WAL mode | Store application records, pending work, idempotency information and reconciliation state | Operational data store; chain acceptance is verified against the contract |
| Protocol module using ethers 6 | Canonical content hashing, EIP-712 signing, Merkle construction and verification | A versioned project protocol, not an implementation of every Web3 standard |
| Solidity 0.8.28 contract | Mandates, signature validation, action allowlists, exact nonces, credit accounting and batch history | No token, custody, transfers, upgrade authority or external calls |
| Persistent Anvil EVM, chain ID 31337 | Execute real contract transactions locally and expose logs/state | One development chain; no distributed validators or economic security |
| Node SDK and verification CLI | Exercise the API and verify exported JSON outside the browser | Offline verification alone cannot authenticate a policy or chain anchor |
| Bitcoin learning lab | Demonstrate SHA-256d, hash links, a toy proof of work and UTXO double-spend rejection | Educational model; no Bitcoin network, script engine or real funds |

## Normal execution

1. An owner creates an on-chain mandate with an authorized agent address, a Merkle root of permitted action names, total credit budget, per-receipt cap and expiry. These policy fields are immutable; the owner can revoke the mandate. Mandate creation is an owner transaction, not a portable EIP-712 policy signature.
2. A client supplies a request ID and tool input. The gateway checks the action, cap, expiry/revocation and remaining budget, including pending reservations. A serialized mutation queue and transactional database writes prevent concurrent requests in this process from separately reserving the same remaining credits.
3. An allowed deterministic tool runs. The gateway hashes the input and output, assigns the next receipt nonce, and uses the demonstration agent key to sign an EIP-712 receipt. Idempotency makes a repeated request ID refer to the existing logical request rather than a second execution.
4. Pending receipts are submitted in batches of at most 32. Any relayer may submit a correctly signed batch. The contract checks every receipt and advances accounting atomically; one invalid receipt reverts the entire batch.
5. The contract records the batch root and the previous accepted root for the mandate, updates spent credits and the next nonce, and emits an anchor event. SQLite records the resulting transaction and proof information.
6. Export produces the receipt, signature, content, policy claim and Merkle proof. Offline verification checks internal consistency. Online verification additionally uses the expected deployment to check policy, batch state and the precise anchor transaction event.

Current demonstration tools are `document.digest` (20 credits), `text.redact` (30 credits) and `text.summarize` (40 credits). The summarizer extracts the first three sentences; it does not call an LLM. Credits are accounting units, not cryptocurrency or a settled payment.

## Exactly what is committed

The signed type is:

```text
Receipt(bytes32 mandateId,bytes32 actionHash,bytes32 inputHash,bytes32 outputHash,uint256 cost,uint256 nonce)
```

Its EIP-712 domain includes `name = Prooflane`, `version = 1`, the chain ID and verifying contract address. The domain prevents a valid receipt for one deployment from being treated as a signature for a different deployment. Exact monotonic nonces enforce replay rejection within each mandate.

Input and output use SHA-256 over recursively sorted-key JSON. Array order remains meaningful. This project-specific canonical encoding is shared by signing and verification; it is not advertised as complete RFC 8785 conformance. Integer credit costs and nonces cross JSON boundaries as decimal strings to avoid JavaScript floating-point rounding.

Action leaves are Keccak-256 hashes of case-sensitive action names. Receipt leaves are full EIP-712 digests. Each Merkle parent hashes its two 32-byte children in sorted order; an unpaired odd node is promoted unchanged. A singleton has an empty proof. This differs from the Bitcoin lab's odd-node duplication. A Merkle inclusion proof establishes membership; it does not independently prove receipt order or log completeness. Nonce validation and the recorded previous-root chain supply separate history constraints.

Only receipt fields and the hashes they reference are signed. Human-readable labels, copied policy fields and anchor metadata must be validated separately. A correct hash of false content is still a correct hash.

## Two verification levels

| Result | What the verifier checks | What remains unproven |
| --- | --- | --- |
| Offline integrity | Schema, content hashes, recovered signing address, action proof, receipt cap consistency, root inclusion and domain consistency | The policy owner really published the supplied policy; the root exists on a trusted chain; cumulative accounting and current policy state |
| Chain-backed verification | Offline checks plus the configured chain/contract, on-chain policy and batch data, and the claimed transaction's exact anchor event | Correctness of tool output, completeness of off-chain activity, truth of claimed cost, or public-network finality on a local chain |

An offline bundle cannot establish its own trust root. An attacker could deploy a different contract or supply a fabricated root; accepting only the chain ID, contract address and policy carried inside that same file would authenticate the attacker's story. The online verifier therefore checks the application's expected deployment.

A mandate revoked or expired today may have valid receipts accepted earlier. Report historical chain acceptance separately from whether new work is currently authorized. On the prototype chain, inclusion means a successful local EVM transaction; it is not Ethereum mainnet or rollup finality.

## Crash recovery and consistency

SQLite and Ethereum do not participate in one distributed transaction. A process can stop after a transaction is mined but before the database marks its receipts as settled. On restart, chain-log replay reconciles accepted batches with local records. The local Anvil node is checkpointed after confirmed application mutations and on graceful shutdown. A hard crash before checkpointing can lose recent local-chain changes; this is not a production durability or universal exactly-once guarantee. Tests exercise the mined-and-checkpointed batch window before database indexing, plus exact historical state restoration.

The mutation queue coordinates one gateway process. Scaling to several workers requires durable coordination, reservation ownership, an outbox, relayer nonce management and explicit retry/reconciliation rules. External tools would also need their own idempotency or compensation strategy; the local tools are deterministic and have no external side effects.

## Why use a blockchain here?

SQLite provides fast queries and private application state. Signatures identify the key making a claim. Merkle proofs make one receipt's inclusion compact. An independently observed chain supplies a shared commitment and contract-enforced acceptance rules when parties do not share a database administrator.

A single organization with a trusted operator can often use a signed transparency log or conventional audit database more cheaply. Prooflane uses the chain to make that trust tradeoff visible, and because mandates and receipts are a focused way to demonstrate EVM programming, hashing, signatures, Merkle structures and transaction behavior together. It does not put private document content on chain.

## Threats and remaining work

- A compromised agent key can sign false outputs or costs that still satisfy the on-chain limits. The contract validates authorized claims; it does not run the tools or establish their prices.
- Revocation prevents subsequent settlement, including pending receipts. It cannot erase already accepted history. The gateway must check current policy before starting work, while the contract remains the final acceptance gate.
- A public mandate identifier can be copied and claimed first. Use unpredictable owner-scoped IDs; a production revision should bind creation authority to the identifier by construction.
- Publishing a proof bundle publishes its input and output. Hashes of predictable values are not encryption, and no production secret should be placed in the demonstration data.
- Development wallets have publicly known keys. The service is bound to localhost and is intended for synthetic examples with no funds. Testnet deployment is a provided workflow, not a claim of a completed deployment or security audit.
- RPC availability, chain reorganizations, contract bugs, key recovery and multi-tenant authorization need additional controls before an Internet-facing or financially consequential deployment.
