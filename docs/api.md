# HTTP API

Local base URL: `http://127.0.0.1:3000`; public clients use the verified Render HTTPS URL. Mutations require JSON and `X-Prooflane-Client: prooflane-v1`. Public mode requires a signed visitor cookie from `GET /api/session` and checks the configured host/origin. The SDK handles sessions automatically. Local mode also accepts `local-demo` and stays on loopback.

Guest cookies isolate workspaces, not verified user identities. Reads, execution, anchoring, revocation and exports require the matching scope. The server operates the demo keys and sponsors testnet gas. A deliberately shared bundle can be verified by anyone against the configured deployment.

Responses use JSON. Errors are `{ "error": { "code": "...", "message": "..." } }`. Statuses: 400 validation, 401 missing session, 403 origin/header, 404 missing/inaccessible object, 409 request-ID conflict, 413 excessive body, 415 content type, 422 policy denial, 429 demo limit, 500 unexpected failure, 503 unresolved chain/index operation. `Retry-After` accompanies 429. `TRANSACTION_PENDING` means refresh to recover the saved hash before another send.

| Method and route | Input / result |
| --- | --- |
| `GET /api/session` | Establish/reuse guest cookie; returns mode/session type |
| `GET /api/health` | Process readiness and mode; no database/RPC call |
| `GET /api/state` | Chain identity, catalog, mandates, latest 250 receipts, batches, counts, latest 30 attempts |
| `POST /api/mandates` | `{label,budget,maxPerReceipt,ttlMinutes,tools}`; returns on-chain policy |
| `POST /api/execute` | `{mandateId,tool,input:{text},requestId}`; returns signed pending receipt |
| `POST /api/anchor` | `{mandateId}`; settles up to 32 pending receipts and returns gas/transaction metadata |
| `POST /api/revoke` | `{mandateId}`; owner transaction revokes future settlement |
| `GET /api/receipts/:id/bundle` | Returns portable anchored receipt bundle; unanchored receipt returns 422 |
| `POST /api/verify` | Bundle integrity plus expected deployment, event, canonical block and confirmation checks |

Create a policy:

```json
{"label":"Research copilot","budget":"100","maxPerReceipt":"40","ttlMinutes":60,"tools":["document.digest","text.redact"]}
```

Budgets and receipt costs are integer audit credits, represented as decimal strings. Creation limits a budget to 1,000,000 and TTL to 1–1,440 minutes. Label length is 1–60, input text 1–5,000 characters, request bodies at most 100 KB, and each mandate holds at most 32 pending receipts. Known tools outside a mandate produce a recorded policy denial; unknown tools or malformed requests are validation errors.

Use a request ID with 8–100 letters, digits, underscores or hyphens. Retrying an identical successful request returns the existing receipt with `replayed:true`; different input under that ID returns 409. IDs are scoped to the visitor in public mode, and to the database locally. They are not signed receipt fields. See [public limits](public-deployment.md#limits-and-operations) for quotas and recovery.

Only accepted executions receive signed receipts. Denial entries in the console are local operational records, not signed or anchored proofs. The gateway checks its catalog tariff and pending reservations; the contract validates the agent's signed cost against limits but cannot verify an external service's price.

For a client example, see `sdk/client.mjs` and `examples/agent.mjs`. No arbitrary URL, shell command or downloaded plugin is executed by the tool API.
