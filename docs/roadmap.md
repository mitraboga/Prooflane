# From portfolio prototype to a maintained product

Prooflane retains a reproducible local system and now includes a Render/Neon/Base Sepolia public configuration. Guest isolation, persistent quotas, PostgreSQL locking, a signed-transaction journal and canonical confirmation checks are implemented. See the [deployment runbook](public-deployment.md) for actual live status. This roadmap separates implementation from verified operation.

## Phase 0 — Reproducible portfolio prototype

The current scope is a localhost application: browser UI, native Node.js HTTP API, SQLite WAL, local persistent EVM, mandate/receipt contracts, deterministic tools, proof export, verification CLI, SDK and Bitcoin learning lab. Local contract transactions are real EVM executions; they are not public deployment, distributed consensus or actual payments.

Completion evidence should include:

- A clean setup that compiles, tests, starts the application and runs its demo using the documented commands.
- Contract and protocol checks for wrong signers/domains, replay, invalid allowlists, caps, budgets, expiry/revocation and tampered content or proofs.
- An end-to-end run that exports a proof and verifies the expected anchor transaction.
- An exercised recovery case covering a mined batch whose database update was interrupted.
- A screenshot, a short walkthrough and the exact limitations recorded in the repository.

Treat these as release acceptance criteria. The presence of a script or document alone is not proof that its scenario has passed.

## Phase 1 — Evidence and public testnet

**Objective:** make the engineering claims independently reproducible.

Measure batch sizes 1, 2, 8, 16 and 32 on the same build. Record gas per batch/receipt, proof length, serialized bundle size, execution/verification latency and time spent waiting to fill a batch. Identify hardware, Node version, commit, dataset, repetitions and measurement method. A local EVM measurement is not a production capacity claim.

Use the provided deployment workflow to deploy on an EVM testnet only after supplying an appropriate RPC endpoint and a separate test key. Record the actual chain, contract address, deployment transaction and source-verification outcome. Add an explicit confirmation policy and test wrong-network and replaced-deployment failures. Public testnet deployment has not been performed by the local prototype setup.

Continuous integration, a pinned lockfile, an expanded local/public/PostgreSQL test suite and the benchmark report are included. Public deployment tooling is implemented; faucet funding and a verified live deployment remain acceptance work. Invite another developer to reproduce the setup.

**Exit evidence:** committed benchmark results, passing automation, independently reproduced setup and a documented testnet transaction. No mainnet funds are required.

## Phase 2 — One real agent integration

**Objective:** make the gateway useful for a narrow developer workflow.

Choose one use case, such as an agent preparing release notes from a repository or validating build artifacts. Integrate an actual tool protocol such as MCP and at most one external tool or model provider. Keep tool names, schema validation, input limits and authorization deterministic. Avoid arbitrary shell execution as a shortcut.

Define how timeouts, duplicate calls, retries and external side effects affect reservations and receipts. Decide whether a signed failure receipt is appropriate and version its schema deliberately. Separate a tool's execution evidence from a model's reasoning or quality evaluation; receipt integrity cannot replace correctness evaluation.

If paid resources are needed, introduce an x402 adapter using the current official specification and a test network. Track a payment proof separately from an execution receipt. Until interoperability and settlement are tested, call it an integration experiment rather than x402 support.

**Exit evidence:** one documented external integration, realistic success/failure traces and acceptance tests independent of a live model's variable response text.

## Phase 3 — Shared service reliability

**Objective:** support more than one trusted local user and worker.

Replace development key handling with separate owner and agent identities, secure secret storage, rotation and recovery. Add authentication, organization boundaries, request limits and explicit administrative authorization. Revisit mandate ID ownership, supported account types and contract change/version strategy.

The public demo now uses transactional writes, database advisory locks, signed transaction intents, nonce coordination and event checkpoints. Extend this deliberately serialized design with narrower concurrency, full reorganization rollback, stuck-transaction replacement and fault-injection coverage. Define backup, retention and deletion without implying public commitments can be erased.

Introduce structured logs, operational metrics, traces, health checks, alert thresholds and a recovery runbook. Load-test realistic contention and crash scenarios before selecting a larger database or adding distributed workers.

**Exit evidence:** threat model review, tenant-isolation checks, recovery drills, monitored staging deployment and measured reliability targets. This work is substantial; it is not a configuration-only promotion of the localhost prototype.

## Phase 4 — Production decision

**Objective:** determine whether the product needs a blockchain deployment at all.

Interview intended users about disputed records, trust boundaries and who needs independent verification. Compare a witnessed transparency log, a conventional signed audit system and a public-chain anchor on cost, privacy, availability and operating burden. Keep the simpler design when it meets the requirement.

For real financial transactions or sensitive data, obtain specialist review appropriate to the activity and jurisdiction, and commission a security review of the contract, key management and gateway. State service-level objectives and incident ownership before inviting users to rely on the system.

Potential research extensions include ERC-8004 identity links, smart-account signatures, encrypted evidence sharing and zero-knowledge predicates. They are optional hypotheses to evaluate, not current features or prerequisites for a credible portfolio project.
