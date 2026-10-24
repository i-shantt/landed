# STATUS.md

Written 2026-10-24 ~01:20 PT by the autonomous build. Read this first, then `DEMO.md`.

## TL;DR

The core is done and verified: **no payment can reach a destination that is not verified for that vendor**, with the AI on, off, or fooled. All three checkpoints passed. 68 vitest tests green; 30 eval scenario runs (20 scenarios, fraud ones run twice: extractor on and off) all pass with **0 false releases**. The UI runs, the demo script matches it, and the recovery package is generated (Claude prose, numerically verified against deterministic fields).

Not verified live: Vapi voice (no key) and Apify crawl (no token). The browser click-through of DEMO.md (A–E and the portal) was done in Chrome at 01:45 and matched the script.

## Run it

```bash
# terminal 1 (Convex local deployment; already configured in web/.env.local)
cd web && npx convex dev
# terminal 2
cd web && npm run dev            # http://localhost:3000
# once per machine, mirror server keys from web/.env.local into the Convex env
cd web && node scripts/sync-env.mjs
```

Seed data: Settings → **Re-seed fixtures** (or `curl -X POST http://127.0.0.1:3211/eval/reset -H 'x-eval-key: dev' -H 'content-type: application/json' -d '{"which":"full"}'`).

Tests and checkpoints (all passing as of this write):

```bash
cd web && npx vitest run                         # 68 tests: guard, canRelease, clock, invariants (17), checkpoint1, extras
cd web && node scripts/checkpoint2.mjs           # Checkpoint 2: demo paths through the UI's public functions
cd eval && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd eval && .venv/bin/python runner.py --base http://127.0.0.1:3211 --key dev   # Checkpoint 3: 30/30; writes results.json, RESULTS.md, posts to /eval
cd web && npx tsc --noEmit && npx next build     # 0 type errors, 14 routes
```

`EVAL_KEY` is unset on the deployment, so the eval key is `dev` (a warning is logged). `ACCOUNT_HMAC_KEY` / `ACCOUNT_ENC_KEY` are unset: deterministic dev keys are used with a loud warning. Set both with `npx convex env set` before any non-demo use.

## What works end to end (exact)

- **Intake → hold.** Mailbox (or `/eval/inject`) → `messages.insert` → Node intake action → rules or Claude extractor (incl. PDF footer) → `bankAccounts.createUnverified` → new versioned row `unverified`, case `HELD`→`PROBE_SENT` in one transaction, open invoices re-pointed to the requested account and `held`, probe queued for the next Same Day ACH window (13:00/17:00/18:00 ET, weekends roll), availability timer (13:30/17:00/18:00 receiver-local).
- **Lookalikes** (homoglyph, subdomain, display-name spoof) are bound to the vendor they claim to be and get the same probe treatment; `sender_domain_mismatch` is logged. Unknown senders with no claimed vendor are logged and nothing is paid.
- **Payment boundary.** `payments.send` is the only writer of `payments` (static test). Refusals: `destination_not_verified`, `destination_vendor_mismatch`, `destination_superseded`, `destination_disputed`, `destination_stale_version`, `invoice_missing`, `invoice_not_open`. Refusal is returned as `{ok:false, reason}` and logged as `payment_refused` (a throw would roll back the audit event).
- **Probe → confirmation → release.** Clock advance fires timers → probe settled/available → `AWAITING_CONFIRMATION` → SimVoice "call" (or portal token) → statement → `canRelease` (16 bound checks, exact order per the brief) → `VERIFIED`, old account superseded, held invoices reopen. Wrong amount or "nothing arrived" from the contact of record → `NEEDS_HUMAN`. No answer → recorded, not escalated, SLA (24h) escalates.
- **Pay → landing.** `PAID`, landing-check call at +2h (ACH) / +1h (wire), landing statement from the contact of record → `LANDED` → `CLOSED`. Deadline without landing → `UNCONFIRMED` → package → `RECOVERY`.
- **Human actions.** Request human review, Mark fraud (account `disputed`, `RECOVERY`, package), Reject change (account `rejected`, invoices restored to the previous account, `CLOSED`), Exceptional release (two distinct approvers, reason ≥ 20 chars, from `NEEDS_HUMAN` only), Supersede contact, Add record contact (human-attested), Edit bank account.
- **Portal.** `/portal/login` (bcrypt, cookie session) → `/portal` lists open requests → `/confirm/[token]` with 3 attempts; wrong amount from the contact of record escalates; exhausted attempts escalate.
- **Recovery package** at `/cases/[id]/package`: deterministic fields (refs, amounts, eligibility incl. Kill Chain criteria), six sections with Copy buttons; prose from Claude when keyed and every number verified, else templates.
- **Replay** (`?replay=1` or the "Replay timeline" button): reads once, animates at 10x, no live subscription.
- **Nessie rail** (`RAIL=nessie` or Settings `rail`): verified live; see "stubbed and how to swap" for its limitations.
- **Eval**: `/eval` page shows the posted runs and the metrics block.

## What is stubbed / simulated and how to swap in the real thing

| Piece | Today | Swap |
|---|---|---|
| Bank rail | `SimRail` (in-DB ledger). `NessieRail` works live but models a credit as a Nessie deposit + withdrawal (no payee on transfers in the current API) and sends integer **cents** because Nessie truncates amounts to integers. | Implement `Rail` in `web/convex/rails/`, select in `rails/select.ts`; set `RAIL`. Settlement/availability stay engine-driven (timers). |
| Time | Demo clock (`clock` table). | Settings → mode `live`; the 30s cron ticks timers on wall time. |
| Vendor voice | `SimVoice`: a scripted statement (eval) or a human typing on the case page ("Simulated vendor answer"). `VapiVoice` is written (assistant without any amount, TEST_PHONE_NUMBERS gate, tool `recordStatedAmount`, webhook with leak check + re-probe) but **not run against Vapi**. | `npx convex env set VAPI_API_KEY … VAPI_PHONE_NUMBER_ID … TEST_PHONE_NUMBERS +1…` and `VOICE=vapi`; verify the webhook payload shape in `channels/vapiWebhook.ts` (`tool-calls` and `end-of-call-report` are both handled). |
| Email auth | Seeded `authResult`; DMARC toggle in the mailbox. | Real mail ingestion is out of scope. |
| Account validation provider | Stub returns `no_coverage` (every case probes). | Implement `ValidationProvider` in `validation/provider.ts`. |
| Vendor website crawl | `discovery.discoverFromWebsite` (Apify website-content-crawler) written; no token; `.example` fixture domains are not crawlable. | `npx convex env set APIFY_TOKEN …` and a vendor with a real domain. |
| Vendor's bank statement | The eval reads the probe amount from a **test-only** endpoint `GET /eval/probeAmount/{caseId}` (EVAL_KEY); the demo operator reads it from the SimRail ledger or that endpoint. | Nothing to swap; the real vendor reads their statement. |
| Portal "login" | Seeded `portalCredentials` (username = vendor slug, password `landed-demo`), bcrypt cost 6, 12h cookie session. Labeled prototype. | Real auth is out of scope by design. |

## Checkpoints

- **Checkpoint 1** (payment invariant): `cd web && npx vitest run` → `tests/checkpoint1.test.ts` + `tests/invariants.test.ts`; also reproduced over HTTP against the live deployment.
- **Checkpoint 2** (demo paths): `cd web && node scripts/checkpoint2.mjs` → "CHECKPOINT 2 PASSED".
- **Checkpoint 3** (eval + extras): `cd eval && .venv/bin/python runner.py` → 30/30; `eval/RESULTS.md` present; `DEMO.md` matches the UI; this file.

## Known bugs / rough edges

- After a case is closed (e.g. Reject change), its probe timers still fire and update the probe row (the deposit did settle); the timeline events are suppressed for closed cases.
- Settings "Jump to next ACH window" and "Jump to availability" both advance to the *next pending timer* (there is no per-kind query); press twice.
- `/eval/reset` wipes `settings`, including the remembered Nessie customer/account ids, so a new Nessie customer is created after each reset (Nessie accumulates test customers).
- Nessie deposits are created with `status: pending` and never completed by us; `getStatus` is informational, the engine's timers decide settlement.
- Claude extractor needs `strict` + all-required nullable fields; forced `tool_choice` returns 400 on claude-sonnet-5-5 (handled). If the key is missing it falls back to rules and logs it.
- The eval's time-to-release metric is ~60h because the demo clock starts on a Friday night and the first ACH window is Monday 13:00 ET. Expected.
- `web/tests` is excluded from `tsconfig.json` so `next build` does not type-check test files (vitest does). Two helper casts in `tests/fixtures.ts` / `tests/harness.ts` are loose.

## What I would do next, in priority order

1. Set `ACCOUNT_HMAC_KEY`, `ACCOUNT_ENC_KEY`, `EVAL_KEY` on the deployment.
2. Vapi: add a key + a test number, dial once, confirm the webhook shape and the leak check end to end.
3. Add a "Pay to the previous verified account" shortcut on NEEDS_HUMAN cases (today: Reject change, then Pay).
4. Nessie: complete deposits (`PUT /deposits/{id}` → completed) when the engine marks the probe settled.
5. More refusal-path tests on `payments.send` (stale version via a real re-entry flow; disputed via Mark fraud) and a vitest for lookalike resolution.
6. Apify crawl against a real vendor domain.

## Files the team will want

- `web/convex/guard.ts` (the gate), `cases.ts` (`tryRelease`), `payments.ts` (`send`), `bankAccounts.ts` (versioning), `confirmations.ts` (channel acceptance), `timers.ts`/`clock.ts` (deterministic time).
- `web/tests/invariants.test.ts`, `web/scripts/checkpoint2.mjs`, `eval/runner.py`, `eval/scenarios/*.yaml`, `eval/RESULTS.md`.
