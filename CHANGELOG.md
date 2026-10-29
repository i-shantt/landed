# Changelog

## 2026-10-29 — sign-in: operators are who the session says they are

Convex Auth (email + password, self-hosted) replaces the browser-side operator picker. Two `core:` commits (schema, `payments.ts`), each with a failing test first; everything else additive.

### Added

- **Convex Auth** (`convex/auth.ts`, `authCallbacks.ts`, `authSetup.ts`): Password provider with a 12-character minimum; auth tables plus `users.operatorId` linking a user to an `operators` row; invite-by-email (an admin creates the operator row with the email, sign-up with that email links it, anything else is `signup_not_invited`); the first user of an empty deployment bootstraps the admin; `beforeSessionCreation` refuses unlinked or deactivated operators; `inviteAdmin` / `setupAdmin` / `ensureDemoAccounts` for provisioning; `operator_account_linked` and `operator_invited` audit events.
- **`controls/actor.ts`**: `requireActor(ctx, roles?)` resolves the session to an active operator with the same error tokens as before plus `unauthenticated`; actions resolve through `internal.controls.actor.resolve`. `controls.operators.me` for the UI.
- **Web**: `proxy.ts` gates the workspace (marketing pages, `/signin`, the vendor portal and `/api/auth` stay public), `/signin` with sign-in, invite sign-up and one-click demo accounts, `UserMenu` replaces the operator picker, `useOperator()` reads the signed-in user.
- **Tests**: `asUser(t, role)` / `actors(t)` harness; auth, callbacks, segregation-of-duties, deactivation, identity propagation into actions, reseed survival; a static rule that no function takes `operatorId` as an argument. 256 → 268 vitest.
- **Ops**: `scripts/sync-env.mjs --generate` creates and sets `SITE_URL`, `JWT_PRIVATE_KEY` and `JWKS` per deployment (RS256 via `jose`, never shared between dev and prod); `prod-seed.mjs` ensures operators and the demo accounts; `record-demo.mjs` signs in.

### Changed

- 19 functions no longer take `operatorId`; onboarding records the signed-in operator (the REST path keeps `api:<key name>` attribution through internal mutations); `payments.attestLanded` takes the operator from the session and `payments.send` stamps the signed-in operator's name over the client label (scripted callers keep their label).
- `SECURITY.md`: "No end-user authentication" is gone from Known limits; what remains open is that public queries are readable without a session.

## 2026-10-29 — learned model and transaction monitoring

Trained offline on public data, scored inside Convex on read. Nothing here writes to the database or touches the frozen payment boundary (`tests/modelCannotRelease.test.ts` walks `convex/risk/` and `convex/monitoring/` for writes, schedulers and imports of `guard`/`payments`/`cases`).

### Added

- **ML pipeline** (`ml/`): declarative data registry with resumable, sha-verified fetch from Hugging Face (PaySim, Sparkov credit-card transactions, phishing emails, CLAIR fraud emails; Kaggle fallback) and a committed `MANIFEST.json`; one 20-feature contract shared by Python and TypeScript (amount, hour, weekday, rail, new beneficiary, 24 h / 7 d velocity, amount vs beneficiary and payer medians, beneficiary age, round amount, just-under-threshold); leakage-free time splits; logistic regression (shipped) against HistGradientBoosting (reported ceiling) with a cost-ratio threshold chosen on validation; email TF-IDF (1–2 grams, ASCII tokenizer that TypeScript reproduces exactly) + logistic regression; SVG evaluation plots; synthetic AP scenario set (bank change then pay, duplicate invoice, structuring, new vendor, lookalike domain) reported separately from public-data metrics; model card; `make -C ml all` reproduces `metrics.json` byte-for-byte.
- **In-app scoring** (`convex/risk/model/`): pure linear and text scorers over bundled JSON weights with per-feature contributions; Landed feature builder over a merged payment history (live `payments` plus seeded paid invoices); `assessCase` gains a `model` block (payment model on the invoice that would follow the new account, text model on the request email) and `combinedScore = max(rules, model)` so the model can raise attention and never dilute a rule hit; payment-run lines carry a model assessment; `GET /api/v1/payments/{id}` and `/payments/{id}/risk`. 50 + 50 parity fixtures scored with the exported rounded weights match within 1e-6.
- **Transaction monitoring** (`convex/monitoring/`): nine signals evaluated against the vendor's own history, cut strictly before the candidate (velocity 24 h / 7 d vs the vendor's weekly median, robust z-score with MAD, amount vs median, structuring clusters just under the approval threshold within 72 h, dormant-vendor spike, first payment to a recently verified account, round amount, off-hours initiation); beneficiary trust score 0–100 with audited components; 7/30-day trend in the company timezone. `policy.monitoringReviewAbove` (off by default) turns a flag into a required approval (`policy_monitoring_review_required`). Monitoring page, trust badge on the vendor page, `GET /api/v1/risk/trend`, `/vendors/{id}/trust`, `/payments/{id}/monitoring`.
- `web/scripts/sync-model-metrics.mjs` renders the model's held-out numbers into the README from `ml/artifacts/metrics.json`; the gate fails when they drift.

### Changed

- `scripts/verify.sh` reads the vitest summary from the whole output (vitest 5 appends an isolate hint after it).
- Tests 213 → 256 (vitest) plus 14 Python tests under `ml/tests`.

## 2026-10-25 — from hackathon demo to payment-control platform

Built after Cal Hacks 13.0 judging on top of the `v2-overnight-3` engine and the redesigned workspace from PR #1. Everything is additive to the frozen payment boundary except the `core:`/`core-fix:` commits listed, each of which was made with a failing test first.

### Added

- **Risk engine** (`convex/risk/`): deterministic, explainable 0–100 score per case from 16 signals (email authentication, lookalike sender, reply-to mismatch, phone changed with the bank, urgency and secrecy language, off-hours send, amount at stake, vendor tenure, repeat changes, ABA checksum, bank change, emailed receipt claims, provider mismatch, account reused across vendors, manual edit without a document). Panel on the case page, column in the queue and CSV, `GET /api/v1/cases/{id}/risk`.
- **Controls layer** (`convex/controls/`): named operators with server-enforced roles (clerk / approver / admin); maker-checker approvals consumed by exactly one payment; payment policy evaluated inside the boundary (dual approval above an amount, risk review above a score, cooling-off after verification, rolling daily vendor limit, ACH-first for a never-paid account, block on an open screening hit), off by default with a recommended preset; admin kill switch for demo-only functions. Pages: Approvals, Controls; operator picker in the top bar; payment run shows “needs approval” lines and a sent list.
- **Sanctions screening** (`convex/screening/`): Jaro-Winkler + token-sort matcher with legal-suffix normalisation, synthetic demo watchlist, parsers for the real OFAC `SDN.CSV`/`ALT.CSV`, screening at onboarding and on demand, approver dispositions (false positive / confirmed), vendor panel and Controls section.
- **Dashboard** (`/dashboard`): money held, money protected from diversion, people needed, median time to verify, pipeline, risk tiers, 30-day trend, a cross-module “needs you” queue and recent activity.
- **Payments ledger** (`/payments`): every payment with landing state and an operator attestation path for payments without a case.
- **Public REST API v1** (`convex/apiRoutes.ts`, `convex/api/`): scoped API keys (hashed, shown once), vendors, bank changes, cases (+ events, risk), invoices, payments (same boundary, 409 on refusal), events feed, payment files; `Idempotency-Key` with 24-hour replay and 409 on conflict; cursor pagination; per-key rate limit; OpenAPI 3.1; Developers page with quick start.
- **Outbound webhooks** (`convex/webhooks/`): endpoints by event type, HMAC-SHA256 `Landed-Signature` with timestamp tolerance, retry schedule (1 m → 72 h, 8 attempts), SSRF guard, built-in signed inbox that shows the receiver side.
- **Payment files** (`convex/exports/`): Nacha ACH generator (94-character records, CCD/PPD/CTX, entry hash, blocking, Micro-Entry `ACCTVERIFY` builder, parser, masking) and ISO 20022 `pain.001.001.03` generator; files built only from payable lines, full file server-side, masked preview in the browser, download with a `files:read` key.
- **Controls matrix** (`/compliance`): 20 controls mapped to SOC 2 TSC, NIST CSF 2.0 and COSO with test evidence and CSV export; audit chain verification.
- `ARCHITECTURE.md`, this changelog.

### Fixed (security hardening after an external-style review)

- `core-fix`: the Vapi webhook requires a shared secret (`VAPI_WEBHOOK_SECRET`, sent back by Vapi as `x-vapi-secret`) and binds a message to a case only through calls Landed placed (`voiceCalls`), never through metadata in the request body; malformed tool arguments are logged, not thrown.
- `core-fix`: closed a probe-amount oracle. `canRelease` checks acceptance and contact before comparing amounts; statements that are not accepted never reach the gate and never produce an amount-derived refusal reason.
- `core-fix`: probe-mode transcripts (voice notes, emailed claims) are no longer returned to the browser.
- `core-fix`: an assistant that says an amount out loud re-issues the probe once and returns the case to `PROBE_SENT` (previously the re-probe dead-ended); a second leak escalates to a human.
- `core-fix`: landing is tracked for every payment, not only the first payment of a case; operators can attest landing.
- `core-fix`: rejecting a change never resurrects an account that a different case superseded; held invoices move to the vendor's current verified account.
- `core-fix`: a previously rejected or disputed account number, or one already requested by another vendor, skips the probe and goes straight to a human.
- `/eval/*` fails closed when `EVAL_KEY` is unset; constant-time key compares; numeric validation on clock endpoints; rate-limit buckets key on the trusted proxy hop; per-timer error isolation in `tick`; intake marks a message `error` instead of leaving it pending.
- Frontend: error and not-found pages, connection banner, WCAG contrast and minimum text sizes, mode chips visible on desktop, countdown guards, stale invoice selection, keyboard-reachable tooltips, label drift between sidebar and page titles, dead CSS and components removed, lint warnings cleared.

### Measured

Unit and invariant tests 118 → 209; scenario suite still 40/40 after every core change.
