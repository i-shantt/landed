# API latency

Measured by `web/scripts/bench-api.mjs` on 2026-11-06 against the cloud dev Convex deployment from a laptop
(sequential requests, wall-clock including network round trip, 30 samples per route after one warm-up call; a key minted for the run with
`read` and `write:payments` scopes). Numbers move with the network and the deployment's region; the shape is the point: every route
is one Convex query or mutation, and the refused payment is as cheap as a read because the guard runs inside the transaction before any write.

| Route | Status | p50 | p95 | max |
|---|---|---:|---:|---:|
| `GET /ping` | 200 | 129 ms | 192 ms | 230 ms |
| `GET /vendors?limit=20` | 200 | 130 ms | 146 ms | 149 ms |
| `GET /vendors/{id}` | 200 | 133 ms | 216 ms | 221 ms |
| `GET /vendors/{id}/trust` | 200 | 133 ms | 143 ms | 234 ms |
| `GET /cases?limit=20` | 200 | 133 ms | 209 ms | 213 ms |
| `GET /cases/{id}` | 200 | 134 ms | 207 ms | 239 ms |
| `GET /cases/{id}/risk` | 200 | 143 ms | 220 ms | 252 ms |
| `GET /invoices?limit=20` | 200 | 138 ms | 377 ms | 508 ms |
| `GET /payments?limit=20` | 200 | 130 ms | 160 ms | 233 ms |
| `GET /events?limit=50` | 200 | 132 ms | 212 ms | 647 ms |
| `GET /risk/trend?window=30d` | 200 | 132 ms | 210 ms | 221 ms |
| `GET /model/health` | 200 | 131 ms | 149 ms | 154 ms |
| `GET /model/labels` | 200 | 132 ms | 147 ms | 223 ms |
| `GET /openapi.json` | 200 | 103 ms | 135 ms | 205 ms |
| `POST /payments (refused 409, unverified destination)` | 409 | 235 ms | 332 ms | 429 ms |

Burst: 150 concurrent `GET /ping` on one key returned 92 × 200, 58 × 429. The limiter is a token bucket per key (600/min, `convex/rateLimit.ts`);
when a burst exceeds what the bucket document can serialise, the API answers 429 with `retry_after_ms` instead of surfacing the write conflict as a 500
(found by the first run of this script, fixed in `apiRoutes.authenticate`).

Re-run: `cd web && node scripts/bench-api.mjs --n 30 --write` (add `--prod` for production). The script needs the Convex CLI's deployment access to mint the key; the plaintext never leaves the process.
