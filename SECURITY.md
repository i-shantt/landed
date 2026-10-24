# SECURITY.md — public surface and why each piece is safe

Confirmed by `web/tests/security.test.ts` (static) and `web/tests/portalHardening.test.ts`, `invariants.test.ts`, `checkpoint1.test.ts` (behavioral). Public = callable from any browser with the deployment URL. Internal = only from other Convex functions. HTTP = `convex/http.ts`.

## Rules that hold on every deployment

- Only `payments.send` inserts a payment, and only to a `verified`, current-version account of the invoice's vendor (I1). Refusals are returned, not thrown, so the audit event survives.
- Only `cases.tryRelease` (bound confirmation) and `cases.exceptionalRelease` (two named humans, from NEEDS_HUMAN) set an account to `verified`.
- `trustLevel: "record"` is written only by the seed and by `contacts.addRecordContact` (a human-attested dashboard action that logs the attester).
- Probe amounts: read by internal functions only (`probes.amountForTest`, `probes.getForRail`). The test-only HTTP route `/eval/probeAmount/*` exists only when `EVAL_PROBE_AMOUNT_ENDPOINT=1` is set on the deployment (dev); on prod it returns 404. Public projections never include the amount; events are redacted before insert.
- `/eval/*` requires `x-eval-key` equal to the deployment's `EVAL_KEY`; prod and dev keys differ (random 16-byte hex each, set in run 2 and verified 401 without the key).
- Account numbers: HMAC-SHA256 hashed and AES-256-GCM encrypted at rest; public queries return routing and last four only.
- No LLM-calling action (`intake.run`, `packageProse.draft`, `explain.narrate`) can reach verification, payment, exceptional release, or contact/account status (I5).

## Public queries (read-only)

| Function | Returns | Why safe |
|---|---|---|
| `cases.list`, `cases.get` | cases, projected accounts (routing, last4, status, version), probe without amount, open invoices | no secrets; amounts of invoices are not secret |
| `events.listForCase`, `events.recent` | redacted audit events | redaction at insert |
| `probes.getPublic` | state and timestamps | amount projected away |
| `confirmations.listForCase` | channel, accepted, reason, contact trust; stated amount only for landing mode | probe-mode statements hidden (would reveal the amount) |
| `bankAccounts.listForVendor`, `bankAccounts.get`, `vendors.*`, `invoices.*`, `contacts.listForVendor`, `messages.*` | vendor master, invoices, threads | no ciphertext/hash; messages are the inbox simulator |
| `settings.get`, `settings.all` | mode flags, demoCases | `simVendorStatement:*` and `portalLock:*` keys are filtered out |
| `timers.pendingForCase`, `timers.nextDue`, `timerQueries.*`, `demoControls.nextStep`, `clock.get` | timers and clock | demo-time only |
| `judge.scenarios`, `judge.get`, `judge.recent`, `evalRuns.list`, `exportCase.caseExport`, `package.getForCase`, `env.presence`, `health.status`, `seed.status` | scenarios, run rows, exports, key presence as booleans | no key values; exports exclude probe amounts |
| `channels.portal.openRequestsForSession`, `channels.portal.tokenInfo` | portal data for a valid session token | session token required; tokens bound to the vendor |

## Public mutations and actions (what they can change)

| Function | Changes | Why safe |
|---|---|---|
| `payments.send` (human) | inserts a payment if `canPay` passes | the boundary; fail closed; idempotent |
| `cases.requestHumanReview`, `markFraud`, `rejectChange`, `close`, `exceptionalRelease` (human) | case state, account disputed/rejected; exceptional release needs two distinct approvers and a 20+ char reason | all logged with actor `human`; none can create a payment |
| `bankAccounts.manualEdit` (human) | new unverified account version + case; supersedes the edited row | never makes anything payable |
| `contacts.supersede`, `contacts.addRecordContact` (human) | contact trust | superseding only reduces trust; adding a record contact is logged with the attester (prototype; production needs a verification process) |
| `messages.insert`, `messages.generateUploadUrl` | inbox simulator; triggers intake | intake can only open cases and hold invoices |
| `channels.simVoice.answer` (human, sim mode only) | records a simulated vendor statement through the normal channel path | labeled simulated; refused unless `voice=sim`; the release gate still decides |
| `channels.portal.confirm` | records a portal statement | requires a valid session and a token bound to that vendor; attempts enforced server-side; wrong amounts escalate |
| `portalAuth.login` | creates a portal session | bcrypt; lockout after 5 failures per username for 15 minutes; cookie set httpOnly/secure/sameSite=lax by the Next route handler |
| `clock.advance`, `clock.advanceTo`, `clock.setMode`, `demoControls.fastForward` | demo clock | demo-only; timers are the same as in live mode |
| `settings.set` | `extractorMode`, `rail`, `voice` only | validated values |
| `seed.reseed` (human, confirm dialog) | wipes and reseeds | demo tool; on prod it is the same as `/eval/reset` which is key-gated |
| `judge.run` | runs a scenario (re-seeds first) | demo tool; flag `judgeMode=off` disables |
| `explain.narrate`, `nessieViewer.transfers`, `discovery.discoverFromWebsite`, `devTools.simulateDiscovery` | read-only / discovered contacts only | discovered contacts can never confirm (I4) |

## Added in run 3 (public)

| Function | Changes | Why safe |
|---|---|---|
| `paymentRun.preview` (query) | nothing | read-only `canPay` evaluation; the page's "Run payable" still goes through `payments.send` per line |
| `audit.events` (query), `audit.chain` (action) | nothing | read-only; the chain is recomputed, never stored |
| `emlIntake.ingest` (action) | inserts a message and dispatches intake | same path as the Mailbox; auth results are taken from headers or reported absent, never assumed |
| `onboarding.createVendor`, `attestRecordContact`, `addFirstAccount`, `issuePortalCredential` | vendor, a human-attested record contact (reason ≥ 15 chars, attester named, logged), first account (unverified + case), portal credential (bcrypt) | these are the onboarding steps a human performs; none touches verification or payments |
| `health.status` (query) / `GET /health` | nothing | key presence as booleans only |
| `demoControls.fastForward` (mutation) | demo clock | demo-only |
| Rate limits | `rateLimit.take` (internal) backs `/portal/login` (10/min per client), `/portal/confirm` (30/min), `/eval/inject|pay|manualEdit` (300/min) | token buckets in `settings` (`rl:*`, hidden from `settings.all`) |

## HTTP actions

`/eval/*` (key-gated): reset, inject, advance, tick, vendorStatement, manualEdit, pay, setting, craftInvoice, createVendor, report, exceptionalRelease, markFraud, portalLogin/Requests/Confirm, overview, case/*, vendor/*, message/*, invoice/*, probeAmount/* (dev only). `/health` (public, no secrets). `/portal/login`, `/portal/confirm` (same rules as the portal mutations). `/vapi/webhook` (records the payload; a statement is accepted only with the case metadata and after the leak check; no key present tonight so nothing can reach it).

## Known limits (prototype)

- The portal "login" is a seeded credential table, not an identity provider.
- `/eval/*` on prod is reachable with the key; the key lives only in `web/.env.local` and the deployment env. Rotate with `scripts/sync-env.mjs --prod --generate` after deleting `PROD_EVAL_KEY` from `.env.local`.
- No per-IP rate limiting on public HTTP actions yet (Phase G item 7).
