# Local HTTP API

Base URL: `http://127.0.0.1:3000`. Mutations require JSON and the header `X-Prooflane-Client: local-demo`. This header and origin/host checks protect against ordinary cross-origin browser requests; they are **not user authentication**. The local service acts as the demonstration owner and agent. Do not expose it to untrusted users.

Responses use JSON. Errors are `{ "error": { "code": "...", "message": "..." } }`. Validation errors use 400, origin/header checks 403, missing objects 404, request-ID conflicts 409, excessive bodies 413, wrong content type 415, policy denials 422, and unexpected failures 500.

| Method and route | Input / result |
| --- | --- |
| `GET /api/health` | Process readiness and local mode |
| `GET /api/state` | Chain identity, catalog, mandates, latest 250 receipts, batches, counts, latest 30 attempts |
| `POST /api/mandates` | `{label,budget,maxPerReceipt,ttlMinutes,tools}`; returns on-chain policy |
| `POST /api/execute` | `{mandateId,tool,input:{text},requestId}`; returns signed pending receipt |
| `POST /api/anchor` | `{mandateId}`; settles up to 32 pending receipts and returns gas/transaction metadata |
| `POST /api/revoke` | `{mandateId}`; owner transaction revokes future settlement |
| `GET /api/receipts/:id/bundle` | Returns portable anchored receipt bundle; unanchored receipt returns 422 |
| `POST /api/verify` | Full evidence bundle; reports offline checks plus expected local deployment checks |

Create a policy:

```json
{"label":"Research copilot","budget":"100","maxPerReceipt":"40","ttlMinutes":60,"tools":["document.digest","text.redact"]}
```

Budgets and receipt costs are integer audit credits, represented as decimal strings. Creation limits a budget to 1,000,000 and TTL to 1–1,440 minutes. Label length is 1–60, input text 1–5,000 characters, request bodies at most 100 KB, and each mandate holds at most 32 pending receipts. Known tools outside a mandate produce a recorded policy denial; unknown tools or malformed requests are validation errors.

Use a request ID with 8–100 letters, digits, underscores or hyphens. Retrying a successful identical request returns its existing receipt with `replayed:true`; reusing the ID for different input returns 409. IDs are scoped to this local database. They are operational metadata and are not included in the signed receipt schema.

Only accepted executions receive signed receipts. Denial entries in the console are local operational records, not signed or anchored proofs. The gateway checks its catalog tariff and pending reservations; the contract validates the agent's signed cost against limits but cannot verify an external service's price.

For a client example, see `sdk/client.mjs` and `examples/agent.mjs`. No arbitrary URL, shell command or downloaded plugin is executed by the tool API.
