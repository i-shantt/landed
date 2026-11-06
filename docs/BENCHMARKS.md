# API latency

Measured by `web/scripts/bench-api.mjs` on 2026-11-06 against the cloud dev Convex deployment from a laptop
(sequential requests, wall-clock including network round trip, 30 samples per route after one warm-up call; a key minted for the run with
`read` and `write:payments` scopes). Numbers move with the network and the deployment's region; the shape is the point: every route
is one Convex query or mutation, and the refused payment is as cheap as a read because the guard runs inside the transaction before any write.

| Route | Status | p50 | p95 | max |
|---|---|---:|---:|---:|
| `GET /ping` | 200 | 140 ms | 233 ms | 234 ms |
| `GET /vendors?limit=20` | 200 | 139 ms | 240 ms | 264 ms |
| `GET /vendors/{id}` | 200 | 141 ms | 253 ms | 337 ms |
| `GET /vendors/{id}/trust` | 200 | 137 ms | 235 ms | 237 ms |
| `GET /cases?limit=20` | 200 | 134 ms | 221 ms | 237 ms |
| `GET /cases/{id}` | 200 | 134 ms | 220 ms | 227 ms |
| `GET /cases/{id}/risk` | 200 | 136 ms | 221 ms | 227 ms |
| `GET /invoices?limit=20` | 200 | 137 ms | 238 ms | 248 ms |
| `GET /payments?limit=20` | 200 | 134 ms | 216 ms | 217 ms |
| `GET /events?limit=50` | 200 | 134 ms | 239 ms | 243 ms |
| `GET /risk/trend?window=30d` | 200 | 134 ms | 174 ms | 216 ms |
| `GET /model/health` | 200 | 131 ms | 142 ms | 145 ms |
| `GET /openapi.json` | 200 | 107 ms | 185 ms | 196 ms |
| `POST /payments (refused 409, unverified destination)` | 409 | 190 ms | 275 ms | 298 ms |

Burst: 150 concurrent `GET /ping` on one key returned 96 × 200, 54 × 429. The limiter is a token bucket per key (600/min, `convex/rateLimit.ts`);
when a burst exceeds what the bucket document can serialise, the API answers 429 with `retry_after_ms` instead of surfacing the write conflict as a 500
(found by the first run of this script, fixed in `apiRoutes.authenticate`).

Re-run: `cd web && node scripts/bench-api.mjs --n 30 --write` (add `--prod` for production). The script needs the Convex CLI's deployment access to mint the key; the plaintext never leaves the process.
