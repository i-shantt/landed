# Changelog

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
