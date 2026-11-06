# Changelog

## 2026-11-06 — saved views and bulk actions on the case queue

- **URL state on `/cases`**: filter, sort, record source and the search text live in the query string (`?filter=&sort=&source=&q=`, written with `replace` and no scroll; typed search debounced), so a view can be linked, reloaded and shared. Unknown values fall back to the defaults.
- **Saved views**: four chips (Needs attention, Ready to pay, Largest holds, Demo cases) are links to those parameter sets; a chip is active only when every other key sits at its default. "Copy link to this view" copies the current URL.
- **Bulk actions**: a checkbox column with select-all-visible; the bar offers *Request human review* and *Reject change* only when every selected case's state accepts it, using the same state sets `cases.requestHumanReview` and `cases.rejectChange` enforce (`bulkEligibility` in `lib/case-queue.ts`). Each case goes through the existing mutation one at a time with a written reason; the status line reports successes and names each refusal. No server change: the frozen core still records one `actor: "human"` event per case.
- Playwright: a deep link restores filter, sort and source and a saved view rewrites the URL; the bulk bar appears on the demo set with both actions correctly disabled (8 → 10 tests).
- Tests: 329 → 335 vitest.

## 2026-11-06 — invoices page

- **`/invoices`**: every invoice on file with its remit account projection (routing, last four, version, status), what the payment boundary would do with it today (payable, a policy hold, or the guard's refusal reason; the same `paymentRun.preview` the run uses), the open case holding it, and the settling payment once paid. Open / held / overdue / paid filters with totals, search by number, vendor or last four, due / amount / vendor sort, overdue highlight, CSV export. Sidebar and workspace search entries.
- **`invoices.listAll`** (session) does the join on the server: the row never carries ciphertext, hashes or identity keys (asserted).
- Playwright: the CleanCo invoice renders with its remit account and a boundary decision (7 → 8 tests).
- Tests: 327 → 329 vitest.

## 2026-11-06 — decision helper for cases that stopped for a human

- **Decision helper** (`lib/decision.ts`, `components/landed/DecisionHelper.tsx`) above the case actions while a case is in `NEEDS_HUMAN`: classifies the case as hostile (nothing arrived at the vendor of record, account reuse or prior rejection, repeated assistant leak, confirmed sanctions match, critical risk), stalled (SLA or portal attempts ran out at low risk with a clear screen) or unresolved (bank and contact changed together, validation mismatch, an operator's own request), lists the facts it used (risk score and top signal, screening, beneficiary trust, statements from the contact of record, open invoices held, other vendors on the same account) and orders reject / mark fraud / exceptional release with a reason for each. Pure function with no write path; the buttons stay in "Case actions" and the guard still decides what pays.
- Labels for the three escalation reasons the case summary used to show raw (prior rejection, reuse across vendors, repeated assistant leak).
- Playwright: the seeded bank-and-phone case shows the helper with three ordered options (6 → 7 tests).
- Tests: 320 → 327 vitest.

## 2026-11-06 — reads require a session

- **Every public query calls `requireActor`** (68 queries; 14 in the frozen core files, changed with the failing test first). Six reads stay public by design and are allowlisted in `tests/security.test.ts`, which now fails when a query is added without the session check: `health.status`, `evalRuns.list`, the new `settings.demoCases` (demo-case ids for `/pitch`), `controls.operators.me` and the two token-gated vendor-portal reads.
- **Internal twins for machine callers** (`<name>Read` handler + `<name>Internal` internalQuery): the REST API, `/eval/*` and the demo seed read through them; the eval suite stayed 40/40 throughout.
- **Browser**: `useAuthedQuery` skips every workspace subscription until the Convex client holds the session token, so sign-out no longer races the redirect; `/about` and `/health` render a public shell for a signed-out visitor. The prod smoke test (`scripts/checkpoint2.mjs`) signs in as the demo approver first.
- **Docs**: `SECURITY.md` Reads section (the Known-limits item is closed), threat model B1 row, controls matrix row A5 "Authenticated reads" (20 → 21 controls).
- Tests: 315 → 320 vitest.

## 2026-11-06 — property pass over monitoring and the model

- **18 more fast-check properties** (`tests/monitoringProperties.test.ts`), 300 runs each, over the pure modules the first pass left to fixed examples: the monitoring flag score is exactly the capped sum of what fired and ignores history order and future rows; structuring clusters, weekly partitions and the robust z-score keep their definitions (band, window, disjointness; shift and scale invariance); the trust score is a bounded integer whose band follows its cut points and which is monotone in every input; the trend conserves the rows inside its window; PSI is non-negative and symmetric, average ranks and Spearman keep their textbook properties, `modelHealth` partitions the paired rows and goes silent exactly below `MIN_ROWS`; label summaries partition and add; dispositions keep their precedence; the 20-feature contract is well-formed for any candidate and both scorers' attributions sum to the logit for any vector, not only the parity fixtures; the tokenizer is idempotent and case-insensitive on ASCII.
- Tests: 297 → 315 vitest (9 → 27 properties).

## 2026-11-05 — operator feedback loop

- **Labels from dispositions** (`convex/monitoring/labels.ts`, `queries.labels`, `GET /api/v1/model/labels`): each of the last 500 payments earns a label from what happened after it, never from the model. A rail or operator-attested landing is benign; an unconfirmed landing, a case in recovery, or a `fraud_reported` event is suspicious; pending payments are counted, not listed. Each row carries the 20-feature vector the model saw at send time, both scorers' probabilities and the rules' flag, so a retraining run reads exactly what production read.
- **`ml/feedback.py` and `make -C ml feedback`**: `web/scripts/export-labels.mjs` writes the export as JSONL under the gitignored `ml/data/feedback/`; the evaluator rescores the features with the exported trees (parity asserted against the recorded probabilities), then reports ROC/PR-AUC and the confusion matrix at the shipped threshold for the trees, the logistic baseline and the monitoring rules. Single-class exports report no AUC rather than a misleading one. Nothing retrains or writes weights.
- Tests: 292 → 297 vitest, 19 → 22 Python.

## 2026-11-05 — model health, properties, benchmarks, threat model

- **Model health on read** (`convex/monitoring/drift.ts`, `queries.health`, `GET /api/v1/model/health`, a section on `/monitoring`): population stability index of the recent half of scored payments against the earlier half, shift of live scores and of each of the 20 features against the training reference exported by `ml/export.py` (`transaction_reference.json`: validation-window deciles and score bins), and agreement between the shipped trees and the logistic-regression baseline (Spearman, flag disagreement). Blocks stay null below ten scored payments so the page never reads noise as drift. 10 tests.
- **Property-based tests** with fast-check (`tests/properties.test.ts`): `canPay` is a yes only on the one path; `canRelease` refuses every combination of up to four perturbations and never produces an amount-derived reason for an unaccepted statement or a non-record contact, whatever the stated amount; Nacha build→parse is the identity on amounts, traces, names, addenda, hash and totals for any 1–40 valid entries; pain.001 control sums, counts, escaping and masking hold for any batch. 9 properties, shrunk counterexamples on failure.
- **API benchmark** (`scripts/bench-api.mjs`, `docs/BENCHMARKS.md`): p50/p95/max per route, the refused payment, and a 150-request burst on one key. The first run found that a burst the per-key token bucket could not serialise surfaced Convex's write conflict as HTTP 500; `apiRoutes.authenticate` now answers 429 with `retry_after_ms`, and the last-used stamp is best effort. 1 test.
- **Threat model** (`docs/THREAT_MODEL.md`): assets, eight trust boundaries, STRIDE per boundary with the test that proves each control, residual risks. **CI security job**: `npm audit` on production dependencies at high+, `pip-audit` on the ML environment, and a CodeQL workflow (TypeScript, Python, Actions).
- Tests: 273 → 292 vitest, 18 → 19 Python.

## 2026-11-05 — boosted trees in the transaction

The gradient-boosted model that was reported as the ceiling now ships; the logistic regression stays as a glass-box baseline next to every score. No frozen file changed.

- `ml/trees.py`: exports a fitted `HistGradientBoostingClassifier` as node arrays (`[feature, threshold, left, right, missingGoesLeft, value]`, leaves `[-1, value]`; thresholds at full double precision, values at 7 decimals) and scores them without numpy, with Saabas path attributions that sum exactly to `logit − bias`. `export.py` writes `transaction_gbm.json` (200 trees, depth ≤ 4, 155 KB) with Platt parameters fitted on the validation window, plus 50 parity fixtures.
- `web/convex/risk/model/trees.ts`: the TypeScript walker; `assessPayment` now scores with the trees and reports `linear: {version, probability, contributions}` for the baseline. API `payment_risk` gains `model_family` and `linear_baseline`; OpenAPI updated; the model panel shows the baseline under the attribution bars.
- Held-out: ROC-AUC 0.980 / PR-AUC 0.558 combined (was 0.877 / 0.134 with the logistic regression). Synthetic AP scenarios rescored with the shipped model: bank-change-then-pay recall 0.963 (linear 0.222), benign false-positive rate 0.7% (linear 7.9%); duplicate invoices and sub-threshold structuring stay with the deterministic monitoring rules. `metrics.json` keeps the linear numbers under `ap_scenarios.linear_baseline`.
- Model card, plots, README/case-study paragraphs (regenerated by `sync-model-metrics.mjs`), resume bullets and the architecture diagram follow. Tests: 268 → 273 vitest, 14 → 18 Python.

## 2026-10-29 — resume kit

- `docs/CASE_STUDY.md`: engineering case study; its measured and model paragraphs are generated by `sync-measured.mjs` and `sync-model-metrics.mjs`, so the gate fails if they drift.
- `docs/RESUME_BULLETS.md`: software-engineering and data/ML bullet sets, each traceable to a file or a generated number.
- `docs/architecture.svg` generated by `docs/architecture.py`, which refuses labels that overflow their boxes; embedded in the README and ARCHITECTURE.md (text diagram kept, collapsed).
- README Highlights section and a demo GIF (`docs/demo.gif`) recorded on the dev deployment.
- CI fixes found by the first runs: lockfile lists the nested `@emnapi` packages the wasm bindings declare (npm ci on Linux), and `next typegen` runs before `tsc` because `RouteContext` lives in `.next/types`.

## 2026-10-29 — CI, container, browser smoke

- **GitHub Actions** (`.github/workflows/ci.yml`): on every push and pull request, lint, typecheck, the vitest suite, the measured-numbers and model-metrics drift checks and `next build` for the web app; the ML unit tests and an eval-runner compile check for Python. A Playwright job runs when repository variables point at a dev deployment. `ml.yml` (manual) reproduces the learned layer from public data on a clean runner and fails if the committed `metrics.json`, weights or README block differ.
- **Docker** (`web/Dockerfile`, `docker-compose.yml`): multi-stage image on `node:24-alpine` with Next's standalone output; Convex stays hosted, the image takes the two public deployment URLs as build args and carries no secrets.
- **Playwright smoke** (`web/e2e/smoke.spec.ts`, `npm run e2e`): the sign-in gate, the demo approver's dashboard, a case's risk panel with the learned-model block, the monitoring page, sign-out, and the public OpenAPI document.
- `web/convex/_generated` is committed (the Convex CLI needs a deployment to regenerate it, which CI and Docker builds do not have); `CONTRIBUTING.md`; CI and live badges in the README.

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
