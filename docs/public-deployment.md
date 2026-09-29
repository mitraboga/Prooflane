# Public deployment: Vercel, Neon and Base Sepolia

One Vercel Hobby Node application serves the website and API on the same HTTPS origin. Neon PostgreSQL persists evidence. An explicitly deployed Solidity contract on Base Sepolia enforces receipt policy. Local development retains SQLite and Anvil; tool behavior, signed schema and the execute → sign → anchor → verify flow are shared.

**Status:** faucet funding and Base Sepolia contract deployment are complete. The [deployment manifest](../deployments/base-sepolia.json) records contract `0x00AAbffF4C9B8D26a7dAF06aEAc509DD133A95Eb`, created in block `46858133`. Its receipt, deployer, runtime bytecode and creation block were independently checked. Vercel deployment and live acceptance checks are in progress; no working public app URL is claimed yet. Render required card verification before creating a service, so the no-card deployment uses Vercel instead.

## Preserve the local archive

Keep the existing `data/` directory and Anvil snapshot. Public mode starts a separate PostgreSQL archive. Old signatures bind chain `31337` and its contract into their EIP-712 domain; they cannot be relabeled as chain `84532` evidence. Export old bundles and verify them against their original deployment when needed.

## 1. Configure Neon

Use a dedicated Free PostgreSQL project in Singapore. In **Connect**, select the production branch and pooled connection. Paste that connection string directly into Vercel's production `DATABASE_URL` secret field. Do not commit it or create an extra plaintext copy.

The adapter verifies remote TLS certificates, uses a small connection pool and initializes the schema on startup. Transaction-level advisory locks support transaction pooling. A stored fingerprint prevents pairing an existing database with a different chain, contract, owner or agent.

Tables hold mandates, receipts, batches, attempts, signed transaction intents, daily counters and indexing checkpoints. Full inputs/outputs stay off chain; exported bundles contain them. Use synthetic documents.

## 2. Create and fund testnet identities

The existing Prooflane deployment already has funded identities and an encrypted wallet file. Reuse them. This section describes provisioning a separate deployment from scratch.

The **owner** pays testnet gas for mandates, anchoring and revocation. The separate **agent** signs receipts off chain and needs no gas. Visitors need no wallet.

On Windows, from the project directory:

```powershell
./scripts/testnet-keys.ps1 -Action Initialize
./scripts/testnet-keys.ps1 -Action Addresses
```

Choose and privately save a password/passphrase of at least 16 characters. `Initialize` saves password-encrypted Ethereum V3 keystores in the Git-ignored `data/testnet-keys.portable.json`. Before printing addresses to fund, it reloads both keys in a separate process, decrypts them and verifies a test signature. Passwords are entered with hidden input and passed to Node through stdin, never command arguments. Back up the encrypted file and keep its password separately; both are needed for recovery.

Run `./scripts/testnet-keys.ps1 -Action Verify` to check access again before funding. Initialization refuses to overwrite a wallet or replace identities after a public deployment or saved deployment transaction exists.

**Legacy Windows encryption failure:** if `ConvertTo-SecureString` reports “Key not valid for use in specified state,” use `./scripts/testnet-keys.ps1 -Action InitializePortable`. This explicitly creates new password-protected identities and preserves `data/testnet-keys.encrypted.json`. It does not recover the old keys or move their balance. Fund only the newly verified owner address; an earlier faucet transfer remains with the old wallet.

Open the [Coinbase developer faucet](https://portal.cdp.coinbase.com/products/faucet), select **Base Sepolia / ETH**, and enter the owner address. Only free testnet ETH is required. See the [official faucet instructions](https://docs.cdp.coinbase.com/faucets/introduction/quickstart) for sign-in requirements.

On other systems, use a trusted wallet/password manager to create distinct testnet-only keys and supply them through the process environment. Public startup rejects common Anvil/Hardhat/Ganache and trivial keys. Do not reuse a real-money wallet.

## 3. Deploy Solidity once

For the existing project, reuse the committed deployment manifest and skip this step.

```powershell
./scripts/testnet-keys.ps1 -Action Deploy
```

Alternatively, with `DEPLOYER_PRIVATE_KEY` or `OWNER_PRIVATE_KEY` already in the process environment:

```sh
npm run deploy:testnet
```

The command permits **Base Sepolia only**, persists the exact signed deployment intent before broadcast, waits for three canonical blocks, and checks runtime bytecode and the actual creation block. Retrying an uncertain deployment resumes its saved transaction; keep the intent while unresolved.

Success creates `deployments/base-sepolia.json` with public address, transaction, block and compiler metadata. Commit that manifest after verification. Explorer source verification is a separate task; the command verifies runtime bytecode itself and does not claim an explorer source-verification badge.

Public compilation normalizes Solidity line endings to LF, so Windows deployment and Linux hosting produce identical metadata and runtime bytecode. Local compilation preserves its previous behavior to keep existing Anvil deployments compatible.

## 4. Deploy Vercel Hobby

Import `mitraboga/Prooflane`, branch `main`, into a **Hobby** project. Select the **Node** preset and repository root `./`. [`vercel.json`](../vercel.json) sets the build, Singapore region, Fluid Compute and a 300-second request limit. Node.js 24 is required. Keep secrets scoped to **Production**; preview deployments must not receive the production database or signing keys.

Vercel detects the root [`server.mjs`](../server.mjs) entry point and captures its Node HTTP server. It shares the standalone application's routes and startup checks. The entry point attaches the PostgreSQL pool to Vercel's lifecycle so idle connections close before an instance is suspended. Database state and transaction recovery never depend on a warm instance or local disk. See [native Node server support](https://vercel.com/docs/functions/runtimes/node-js) and [connection pooling](https://vercel.com/kb/guide/connection-pooling-with-functions).

| Setting | Value |
| --- | --- |
| Node | `24.x` |
| Install | `npm ci --omit=optional` |
| Build | `npm run compile` |
| Entry point | `server.mjs`; standalone/local mode still uses `npm start` |
| Health | `/api/health` |
| Runtime | Fluid Compute, Singapore `sin1`, maximum 300 seconds/request |
| Included files | `web/dist`, compiled contract artifact and pinned Solidity source |
| Deployment | GitHub integration; inspect both Vercel build and GitHub Actions results |

Node serves `web/dist` and the API on the same HTTPS origin. GitHub Actions validates code; Vercel hosts it. No frontend framework rewrite or separate API domain is required.

| Variable | Source |
| --- | --- |
| `NODE_ENV` | `production` |
| `PROOFLANE_MODE` | `base-sepolia` |
| `DATABASE_URL` | Neon pooled connection, entered directly in Vercel secrets |
| `RPC_URL` | `https://sepolia.base.org`, or another trusted Base Sepolia HTTPS RPC |
| `CONTRACT_ADDRESS` | Verified deployment manifest |
| `DEPLOYMENT_BLOCK` | Exact creation block from that manifest |
| `OWNER_PRIVATE_KEY` | Existing funded testnet owner for this deployment |
| `AGENT_PRIVATE_KEY` | Existing distinct testnet receipt signer |
| `SESSION_SECRET` | At least 43 random characters; use 32 random bytes encoded as base64 (44 characters) |
| `CONFIRMATIONS` | `3` |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin; defaults to `https://` plus Vercel's `VERCEL_PROJECT_PRODUCTION_URL` |

Enable Vercel's system environment variables. The application trusts its configured production origin, not arbitrary preview URLs or incoming Host headers. If using a custom domain, set `PUBLIC_ORIGIN` explicitly without a trailing slash.

On Windows, generate a 256-bit session secret directly into the clipboard, then paste it into `SESSION_SECRET`:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" | Set-Clipboard
```

For Windows keys, explicitly run `./scripts/testnet-keys.ps1 -Action CopyOwner`, paste into `OWNER_PRIVATE_KEY`, then repeat `CopyAgent` for `AGENT_PRIVATE_KEY`. These commands copy to the clipboard without printing the keys. Clear the clipboard afterward. Do not put keys in chat, source files or logs.

Select **Deploy** only after all production values are present. Read the assigned production domain from Vercel, and ensure production access is public so visitors do not need a Vercel account. A successful build alone does not prove that database access, signing or anchoring works; run the acceptance steps below.

Startup checks storage, identities, origin, chain, bytecode and deployment block. On Vercel, missing public mode fails closed rather than starting local development keys. Public mode never starts Anvil, falls back to SQLite or deploys a new contract. The build omits optional Anvil binaries and reuses the compiled artifact on cold starts. `.vercelignore` also excludes local wallets and environment files from CLI uploads.

The retained [`render.yaml`](../render.yaml) is an alternative standalone Node deployment configuration. It is not the active no-card hosting route.

## 5. Verify the assigned public URL

Use the production HTTPS URL assigned by Vercel, not an assumed project name. After readiness succeeds:

1. Confirm **Base Sepolia / 84532**, the verified contract and explorer links in the console.
2. Create a mandate, execute digest/redact and demonstrate a summarize denial.
3. Anchor both receipts, inspect the explorer transaction, export and verify a bundle.
4. Modify its output and confirm verification fails.
5. Check that another browser/private session cannot list, mutate or export the first visitor's evidence.
6. Redeploy the same version to a fresh instance and verify persistence with the original cookie and exported bundle.
7. Publish the observed URL, manifest and new screenshots after these checks pass.

Independent verification uses an address and RPC obtained from a trusted source:

```sh
npm run verify -- bundle.json --rpc https://sepolia.base.org --chain-id 84532 --contract YOUR_VERIFIED_CONTRACT --confirmations 3
```

The SDK accepts `new ProoflaneClient(publicUrl)` and manages a visitor cookie. A new Node client starts a separate workspace. Browser cookies last 30 days; clearing them or changing `SESSION_SECRET` loses guest access. There is no account-recovery flow, so export evidence you want to keep.

## Limits and operations

| Resource | Application limit |
| --- | --- |
| Mandates | 5/day/visitor, 100/day globally, 20 total/visitor |
| Chain transactions | 20/day/visitor, 100/day globally |
| Executions, including denials | 100/day/visitor, 1,000/day globally |
| Archive capacity | 500 mandates, 5,000 receipts, 10,000 attempts globally |
| HTTP | 60/minute/session, 300/minute/process |
| Input/batch | 5,000 text characters, 100 KB body, 32 pending receipts/mandate |

Daily counters persist in PostgreSQL and reset at 00:00 UTC. HTTP counters are per instance and reset on cold starts; they are not a distributed rate limiter. Database quotas and advisory locks apply across instances. Limits constrain demo use but do not establish identity or guarantee protection against denial of service. Evidence is not automatically deleted to make room; retention requires operator review.

A process queue and PostgreSQL advisory lock serialize mutations and owner nonces. Signed transactions commit before broadcast. An uncertain send blocks new mutations until the same hash is reconciled. A persistent cursor scans up to five 2,000-block pages per recovery pass; repeated refreshes progress an index behind after a long idle period. Do not delete unresolved intents or casually replace keys. Reverted operations are marked failed; permanently stuck transactions and deep reorganizations need operator recovery.

Settlement and online verification check three canonical L2 blocks by default. This is **testnet inclusion depth**, not Ethereum settlement finality. A mismatching block/event fails verification; the database does not implement full reorganization rollback.

[Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal, non-commercial projects and has usage limits; exceeding them can pause access. [Fluid Compute requests](https://vercel.com/docs/functions/limitations) have a 300-second maximum on Hobby. A transaction confirmation wait is bounded at 120 seconds, but database/RPC delays and queued requests can still time out. Signed transaction intents persist before broadcast and are recovered on a later request. Reconciliation is request-driven; it does not require a permanent background worker.

Neon and Base hold application state independently of Vercel instances. Cold starts, database/RPC quotas and faucet gas can interrupt demonstrations. Keep the local mode available for interviews. No free tier is an uptime guarantee.
