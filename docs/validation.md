# Release validation

## Portable operator wallets — September 14, 2026

- Two new tests passed: separate-process wallet decryption/signing, wrong-password rejection, refusal to overwrite existing files and refusal to replace an identity with a saved deployment transaction.
- An isolated Windows PowerShell 5.1 check passed initialization and verification in separate shells, including a Unicode passphrase. Only disposable test wallets were used.
- All **57 tests passed, zero skipped or failed**, in [Linux CI with PostgreSQL 18](https://github.com/mitraboga/Prooflane/actions/runs/34925601817) on September 15. Syntax checks, Solidity compilation and the dependency audit also passed (zero known npm vulnerabilities).
- The helper preserves legacy encrypted files. A replacement wallet requires its own faucet funding; no old balance or deployment is silently migrated.

## Public-hosting migration — September 13, 2026

- All 43 original local tests passed after integrating the PostgreSQL adapter and public-mode service changes.
- Three added integration scenarios passed: visitor isolation, recovery after a lost broadcast response and durable quotas across restart.
- Eight public configuration/HTTP tests passed, including cookie forgery/expiry, origin/host controls, TLS, unsafe keys, deployment identity and canonical confirmations.
- JavaScript syntax checks and Solidity compilation passed; runtime remains 3,736 bytes.
- The suite defines 55 tests. All passed in [Linux CI with PostgreSQL 18](https://github.com/mitraboga/Prooflane/actions/runs/34801305582) on September 14. The PostgreSQL scenario is skipped locally unless `TEST_DATABASE_URL` is set.
- Real Base Sepolia deployment, Render/Neon integration, public browser screenshots and live restart acceptance remain pending. The existing screenshots below and in the README show the earlier local demo.

## Original local release

Validated on Windows x64 with Node 24.14.1, ethers 6.17.0, Solidity 0.8.28, and native Anvil 1.7.1. Check the repository's Actions page for the independent Linux run.

| Check | Observed result |
| --- | --- |
| JavaScript syntax | Passed for source, SDK, scripts, examples, UI and tests |
| Solidity compilation | Passed; optimizer 200, viaIR, Shanghai; runtime 3,736 bytes |
| Automated suite | 43 passed, zero failures/skips |
| Cryptography | Canonicalization, signatures, domain separation, Merkle proofs and malformed bundles tested |
| Contract attacks | Replay, nonce gaps, wrong tools, caps/budgets, unauthorized revocation, expiry, high-s signatures and atomic failed transactions tested |
| API integration | Complete execution/export/verification path, concurrency, idempotency, policy denials, revocation and HTTP guardrails tested |
| Persistence | Mined/checkpointed batch recovered before local indexing; historical blocks, logs, receipts and storage survive restart |
| Browser flow | Create mandate, execute, anchor, verify and tamper rejection exercised through the visible interface |
| Optional browser agent tool | `verify_loaded_receipt` returned the visible report; invalid extra arguments rejected |
| Benchmarks | Three repetitions per batch size 1, 2, 8, 16 and 32; raw results committed |
| Dependency registry audit | Zero known npm vulnerabilities after replacing the older local-chain package, updating ethers and overriding tmp to 0.2.7 |

The npm audit does not assess native Anvil's Rust dependencies, audit custom contracts, or prove production safety. Browser checks and local tests do not assert public testnet deployment, distributed consensus, payment settlement, complete external-action logging or AI output quality.

The source build uses native optional packages per platform instead of the Anvil meta-package's shell-specific installer, so the same package lock supports Windows and Linux. The Solidity compiler stays pinned; tmp 0.2.7 replaces its older vulnerable temporary-file dependency without changing compilation settings.
