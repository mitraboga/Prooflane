# Public deployment: Render, Neon and Base Sepolia

One Render Free web service serves the website and Node API. Neon PostgreSQL persists evidence. An explicitly deployed Solidity contract on Base Sepolia enforces receipt policy. Local development retains SQLite and Anvil; tool behavior, signed schema and the execute → sign → anchor → verify flow are shared.

**Status:** application support and deployment configuration are prepared. Faucet funding, contract deployment, Render environment configuration and live acceptance checks are pending. No working public URL is claimed yet.

## Preserve the local archive

Keep the existing `data/` directory and Anvil snapshot. Public mode starts a separate PostgreSQL archive. Old signatures bind chain `31337` and its contract into their EIP-712 domain; they cannot be relabeled as chain `84532` evidence. Export old bundles and verify them against their original deployment when needed.

## 1. Configure Neon

Use a dedicated Free PostgreSQL project in Singapore. In **Connect**, select the production branch and pooled connection. Paste that connection string directly into Render's `DATABASE_URL` secret field. Do not commit it or create an extra plaintext copy.

The adapter verifies remote TLS certificates, uses a small connection pool and initializes the schema on startup. Transaction-level advisory locks support transaction pooling. A stored fingerprint prevents pairing an existing database with a different chain, contract, owner or agent.

Tables hold mandates, receipts, batches, attempts, signed transaction intents, daily counters and indexing checkpoints. Full inputs/outputs stay off chain; exported bundles contain them. Use synthetic documents.

## 2. Create and fund testnet identities

The **owner** pays testnet gas for mandates, anchoring and revocation. The separate **agent** signs receipts off chain and needs no gas. Visitors need no wallet.

On Windows, from the project directory:

```powershell
./scripts/testnet-keys.ps1 -Action Initialize
./scripts/testnet-keys.ps1 -Action Addresses
```

`Initialize` refuses to replace existing keys. It stores Windows user-encrypted keys in the Git-ignored `data/testnet-keys.encrypted.json` and prints only addresses. This helper is an operator convenience, not a shared key-management service. Its encrypted file is tied to that Windows user; maintain a secure backup appropriate to your account.

Open the [Coinbase developer faucet](https://portal.cdp.coinbase.com/products/faucet), select **Base Sepolia / ETH**, and enter the owner address. Only free testnet ETH is required. See the [official faucet instructions](https://docs.cdp.coinbase.com/faucets/introduction/quickstart) for sign-in requirements.

On other systems, use a trusted wallet/password manager to create distinct testnet-only keys and supply them through the process environment. Public startup rejects common Anvil/Hardhat/Ganache and trivial keys. Do not reuse a real-money wallet.

## 3. Deploy Solidity once

```powershell
./scripts/testnet-keys.ps1 -Action Deploy
```

Alternatively, with `DEPLOYER_PRIVATE_KEY` or `OWNER_PRIVATE_KEY` already in the process environment:

```sh
npm run deploy:testnet
```

The command permits **Base Sepolia only**, persists the exact signed deployment intent before broadcast, waits for three canonical blocks, and checks runtime bytecode and the actual creation block. Retrying an uncertain deployment resumes its saved transaction; keep the intent while unresolved.

Success creates `deployments/base-sepolia.json` with public address, transaction, block and compiler metadata. Commit that manifest after verification. Explorer source verification is a separate task; the command verifies runtime bytecode itself and does not claim an explorer source-verification badge.

## 4. Deploy Render Free

Use the dedicated Prooflane workspace. Import [`render.yaml`](../render.yaml) as a Blueprint from [this repository](https://github.com/mitraboga/Prooflane). Confirm **Free** compute and **Singapore**. The Blueprint defines one web service and no Render database.

| Setting | Value |
| --- | --- |
| Node | 24.14.1 |
| Build | `npm ci --omit=optional && npm run compile` |
| Start | `npm start` |
| Health | `/api/health` |
| Bind | `0.0.0.0` and Render's `PORT` |
| Auto-deploy | After connected GitHub checks pass |

Node serves `web/dist` and the API on the same HTTPS origin. GitHub Actions validates code; Render hosts it. GitHub Pages and Streamlit are not used.

| Variable | Source |
| --- | --- |
| `PROOFLANE_MODE` | `base-sepolia` |
| `DATABASE_URL` | Neon pooled connection, entered directly in Render secrets |
| `RPC_URL` | `https://sepolia.base.org`, or another trusted Base Sepolia HTTPS RPC |
| `CONTRACT_ADDRESS` | Verified deployment manifest |
| `DEPLOYMENT_BLOCK` | Exact creation block from that manifest |
| `OWNER_PRIVATE_KEY` | Fresh funded testnet owner |
| `AGENT_PRIVATE_KEY` | Distinct fresh testnet signer |
| `SESSION_SECRET` | A random 256-bit secret; generated by the Blueprint as base64 |
| `CONFIRMATIONS` | `3` |
| `PUBLIC_ORIGIN` | Optional exact HTTPS origin; defaults to Render's `RENDER_EXTERNAL_URL` |

For Windows keys, explicitly run `./scripts/testnet-keys.ps1 -Action CopyOwner`, paste into `OWNER_PRIVATE_KEY`, then repeat `CopyAgent` for `AGENT_PRIVATE_KEY`. These commands copy to the clipboard without printing the keys. Clear the clipboard afterward. Do not put keys in chat, source files or logs.

Startup checks storage, identities, origin, chain, bytecode and deployment block. Public mode never starts Anvil, falls back to SQLite or deploys a new contract. The public build omits optional Anvil binaries and reuses the compiled artifact when waking from sleep.

## 5. Verify the assigned public URL

Use the HTTPS URL assigned by Render, not an assumed service name. After readiness succeeds:

1. Confirm **Base Sepolia / 84532**, the verified contract and explorer links in the console.
2. Create a mandate, execute digest/redact and demonstrate a summarize denial.
3. Anchor both receipts, inspect the explorer transaction, export and verify a bundle.
4. Modify its output and confirm verification fails.
5. Check that another browser/private session cannot list, mutate or export the first visitor's evidence.
6. Restart Render and verify persistence with the original cookie and exported bundle.
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

Daily counters persist in PostgreSQL and reset at 00:00 UTC. HTTP counters reset on restart. Limits constrain demo use but do not establish identity or guarantee protection against denial of service. Evidence is not automatically deleted to make room; retention requires operator review.

A process queue and PostgreSQL advisory lock serialize mutations and owner nonces. Signed transactions commit before broadcast. An uncertain send blocks new mutations until the same hash is reconciled. A persistent cursor scans up to five 2,000-block pages per recovery pass; repeated refreshes progress an index behind after a long idle period. Do not delete unresolved intents or casually replace keys. Reverted operations are marked failed; permanently stuck transactions and deep reorganizations need operator recovery.

Settlement and online verification check three canonical L2 blocks by default. This is **testnet inclusion depth**, not Ethereum settlement finality. A mismatching block/event fails verification; the database does not implement full reorganization rollback.

[Render Free](https://render.com/docs/free) can sleep after 15 idle minutes and loses local filesystem changes. Neon and Base hold the public application's state separately. Render currently grants 750 free instance hours/month per workspace, shared by its free web services. Cold starts, database/RPC quotas and faucet gas can interrupt demonstrations. Keep the local mode available for interviews.
