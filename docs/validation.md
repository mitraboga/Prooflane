# Release validation

## Base Sepolia contract — September 15, 2026

- Deployed contract [`0x00AAbffF4C9B8D26a7dAF06aEAc509DD133A95Eb`](https://sepolia.basescan.org/address/0x00AAbffF4C9B8D26a7dAF06aEAc509DD133A95Eb) on chain `84532`; creation block `46858133`. The [manifest](../deployments/base-sepolia.json) includes the transaction, deployer, compiler and source digest.
- A separate read-only RPC check confirmed the successful transaction, expected deployer/address, three canonical L2 confirmations, exact runtime match, code at the creation block and absence of code in the preceding block.
- Runtime Keccak-256: `0x9fbbcf51ec4fe94a6b0e458310e346c26f2e9a9f402f9753a7fc74d9edecf222`. This checks the deployed build; it does not claim an explorer source-verification badge or Ethereum settlement finality.
- Render/Neon app startup and public workflow, isolation, restart and browser acceptance checks remain pending.

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
- Base Sepolia deployment was subsequently verified as recorded above. Render/Neon integration, public browser screenshots and live restart acceptance remain pending. The existing screenshots below and in the README show the earlier local demo.

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
