# SECURITY.md — public surface and why each piece is safe

Confirmed by `web/tests/security.test.ts` (static) and `web/tests/portalHardening.test.ts`, `invariants.test.ts`, `checkpoint1.test.ts` (behavioral). Public = callable from any browser with the deployment URL. Internal = only from other Convex functions. HTTP = `convex/http.ts`.

## Rules that hold on every deployment

- Only `payments.send` inserts a payment, and only to a `verified`, current-version account of the invoice's vendor (I1). Refusals are returned, not thrown, so the audit event survives.
- Only `cases.tryRelease` (bound confirmation) and `cases.exceptionalRelease` (two named humans, from NEEDS_HUMAN) set an account to `verified`.
- `trustLevel: "record"` is written only by the seed and by `contacts.addRecordContact` (a human-attested dashboard action that logs the attester).
- Probe amounts: read by internal functions only (`probes.amountForTest`, `probes.getForRail`). The test-only HTTP route `/eval/probeAmount/*` exists only when `EVAL_PROBE_AMOUNT_ENDPOINT=1` is set on the deployment (dev); on prod it returns 404. Public projections never include the amount; events are redacted before insert.
- `/eval/*` requires `x-eval-key` equal to the deployment's `EVAL_KEY` (constant-time compare). **Fails closed:** a deployment without `EVAL_KEY` has no `/eval/*` at all. Prod and dev keys differ.
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
| `channels.simVoice.answer` (human, sim mode only) | records a simulated vendor statement through the normal channel path | labeled simulated; refused unless `voice=sim` and demo controls are on; the release gate still decides. Known limit: without end-user auth this is reachable by any client (see "Known limits") |
| `channels.portal.confirm` | records a portal statement | requires a valid session and a token bound to that vendor; attempts enforced server-side; wrong amounts escalate |
| `portalAuth.login` | creates a portal session | bcrypt; lockout after 5 failures per username for 15 minutes; cookie set httpOnly/secure/sameSite=lax by the Next route handler |
| `clock.advance`, `clock.advanceTo`, `clock.setMode`, `demoControls.fastForward` | demo clock | demo-only; timers are the same as in live mode; refused when an admin has turned demo controls off (`controls.demoGuard`) |
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

`/eval/*` (key-gated): reset, inject, advance, tick, vendorStatement, manualEdit, pay, setting, craftInvoice, createVendor, report, exceptionalRelease, markFraud, portalLogin/Requests/Confirm, overview, case/*, vendor/*, message/*, invoice/*, probeAmount/* (dev only). `/health` (public, no secrets). `/portal/login`, `/portal/confirm` (same rules as the portal mutations). `/vapi/webhook`: requires `x-vapi-secret` equal to `VAPI_WEBHOOK_SECRET` (set as `server.secret` on every assistant Landed creates; fails closed when unset). The case and contact are resolved **server-side** from the Vapi call id through the `voiceCalls` table written when Landed placed the call; metadata in the request body is forensic only. Recording is refused unless the voice channel is `vapi`. The leak check covers assistant turns and tool-call notes; a leak re-issues the probe once (case back to `PROBE_SENT`), a second leak escalates to a human. Malformed tool arguments are logged (`voice_webhook_malformed`), never thrown. `/webhooks/inbox`: the built-in demo receiver; verifies `Landed-Signature` against the secrets of endpoints registered at that URL and stores the result. `/api/v1/*`: see below.

## Added after the hackathon (public)

| Function | Changes | Why safe |
|---|---|---|
| `controls.operators.*` | operator rows (admin only for `create`, which is an invite by email, and `deactivate`); `me` reads the signed-in operator | who acts comes from the Convex Auth session (`controls/actor.ts` → `requireActor`), never from a client-supplied id; a static test fails if any function takes `operatorId` as an argument |
| `controls.approvals.request` / `decide` | approval rows; `decide` needs role approver/admin and a different operator than the requester | an approval never substitutes for verification: it can only be requested for a destination `canPay` already accepts, and `payments.send` consumes it only after the guard passes |
| `controls.policy.set` / `applyRecommended` (admin) | the policy JSON (validated) | policy can only add refusals inside `payments.send`; logged with before/after |
| `controls.demoGuard.setDemoControls` (admin) | kill switch for clock, simulated answers, re-seed | reduces the public surface; cannot be flipped on without an admin session |
| `screening.screen.screenVendor` / `screenAll` / `review` | screening rows; `review` needs approver/admin | screening can only block (through policy), never release |
| `api.keys.create` (admin action), `revoke` | API keys stored as SHA-256; plaintext returned once | scoped; per-key 600/min; `touch` updates last-used at most once a minute |
| `webhooks.dispatch.createEndpoint` / `createInboxEndpoint` / `setActive` / `remove` / `pumpNow` / `sendTest` (admin) | endpoints (secret server-only), deliveries | HTTPS only, private hosts refused (SSRF), payloads are the redacted audit payloads, HMAC-signed, bounded retries |
| `exports.paymentFiles.build` (any active operator) | a `paymentFiles` row + a storage blob | built only from lines that pass guard **and** policy; the full file (account numbers) stays in storage and is served only to a `files:read` API key; the browser gets a masked preview; building moves no money |
| `payments.attestLanded` (any signed-in active operator, note required) | `landingState` of a payment | landing is an after-the-fact reconciliation; it cannot create or release a payment; logged with the operator's name and id from the session |
| `auth.signIn` / `auth.signOut` (Convex Auth, Password provider) | `users`, `authAccounts`, `authSessions`, `authRefreshTokens` | passwords are scrypt-hashed by the library (12+ characters); sign-up succeeds only for an email an admin invited (an active, unlinked `operators` row) or, once, for the first user of an empty deployment who becomes admin; `beforeSessionCreation` refuses unlinked or deactivated operators; sessions are RS256 JWTs (1 h) with refresh tokens in httpOnly cookies set by `proxy.ts`; `requireActor` re-checks `active` on every call so deactivation is immediate |
| `analytics.*`, `paymentQueries.listDetailed`, `risk.assess.*`, `screening.screen.forVendor/summary/pending`, `api.keys.list`, `webhooks.dispatch.endpoints/deliveries/inbox`, `exports.paymentFiles.list` (queries) | nothing | read-only projections; no ciphertext, no probe amounts, no key plaintext, no webhook secrets (a hint only) |

### REST API `/api/v1/*`

Bearer `ld_live_sk_…` → SHA-256 lookup; scopes `read`, `write:changes`, `write:payments`, `write:vendors`, `files:read`, `webhooks:manage`. `Idempotency-Key` on POST: same key + same body replays the stored response (24 h), same key + different body → 409. Every write calls the same mutation the dashboard calls: `POST /payments` runs `payments.send` and returns 409 with the guard's or policy's reason; `POST /bank-changes` runs `bankAccounts.manualEdit` (new unverified version + case). Typed errors, cursor pagination, OpenAPI 3.1 at `/api/v1/openapi.json` (no key needed for the spec).

## Fixed after review (2026-10-25)

- Probe-amount oracle: `canRelease` now checks acceptance and contact before the amount; unaccepted statements never reach the gate; probe-mode transcripts are not returned by `confirmations.listForCase`.
- Rate-limit buckets key on the **last** `X-Forwarded-For` hop (platform-appended), not the client-controlled first value.
- `tick` isolates per-timer failures (`timer_failed` event) so one bad timer cannot wedge every deadline; `intake.run` marks a message `error` instead of leaving it `pending` forever.
- `/eval/advance` and `/eval/advanceTo` validate numbers (a `NaN` offset used to brick the demo clock).
- `rejectChange` restores a superseded account only when no other account is verified (it could resurrect an account another case had replaced).
- Known-bad account numbers (rejected/disputed version, or the same hash under another vendor) skip the probe and open straight to `NEEDS_HUMAN`.

## Known limits (prototype)

- **Identity.** Operators sign in with email and password (Convex Auth, self-hosted; no third-party identity provider). Every mutation and action that acts as an operator resolves the signed-in user to an active `operators` row and checks the role on the server; the browser never names an operator. Still open: **public queries** (case views, vendor lists, the audit log) are readable by any client that knows the deployment URL because the eval runner, `/pitch` and `/health` rely on them; gating reads behind the same session is the next step. SSO (SAML/OIDC) would replace the Password provider without changing a rule.
- **Demo accounts are public by design.** `demo@landed.example` (approver) and `clerk@landed.example` (clerk) with the passwords printed on `/signin` let a reviewer use the deployed app. An approver cannot change policy, mint API keys, manage webhooks or operators, or flip the demo kill switch; the admin account is invited by email and its password is set by its owner at sign-up.

- The portal "login" is a seeded credential table, not an identity provider.
- `/eval/*` on prod is reachable with the key; the key lives only in `web/.env.local` and the deployment env. Rotate with `scripts/sync-env.mjs --prod --generate` after deleting `PROD_EVAL_KEY` from `.env.local`.
- Public Convex functions (`portalAuth.login`, `channels.portal.confirm`) are rate-limited only when called through the HTTP routes; the per-username lockout still bounds password guessing.
