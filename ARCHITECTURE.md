# Architecture

Landed is a payment-control plane for accounts payable. One structural rule sits under everything: **no payment to a bank account that has not been verified for that specific vendor**, enforced in the database transaction that writes the payment, not in a prompt, a UI, or a policy that can be switched off. Everything else in the product (risk scoring, approvals, policy, screening, the API) layers on top of that boundary and can refine it, never relax it.

```
                ┌────────────────────────────────────────────────────────────────────────┐
                │                           Next.js 16 workspace (Vercel)               │
                │  dashboard · cases · vendors · mailbox · payment run · payments       │
                │  approvals · controls · developers · compliance · audit · portal      │
                └───────────────┬───────────────────────────────────────┬───────────────┘
                                │ useQuery / useMutation (real-time)     │ Bearer ld_live_sk_…
   email / .eml / ERP ──┐       ▼                                        ▼
                        │  ┌──────────────────────────── Convex ─────────────────────────────┐
   POST /bank-changes ──┼─▶│  intake (rules | Claude)  →  bankAccounts.createUnverified      │
                        │  │                               │ new version, status=unverified  │
                        │  │                               ▼                                  │
                        │  │   cases.openCase  HELD ──▶ PROBE_SENT ──▶ AWAITING ──▶ VERIFIED  │
                        │  │     │ invoices re-pointed + held      ▲          ▲          │     │
                        │  │     │ known-bad account → NEEDS_HUMAN │          │          │     │
                        │  │     ▼                                 │          │          ▼     │
                        │  │   probes.create (11–99¢, ACCTVERIFY) ─┘   canRelease   payments.send
                        │  │     │                                      (16 bound   canPay + policy
                        │  │     ▼                                       checks)        │     │
                        │  │   Rail (Sim | Nessie)   channels: SimVoice | Vapi+Cartesia | portal │
                        │  │                         confirmations.recordFromChannel           │
                        │  │   clock + timers.tick (demo or live) ─ SLA, availability, landing  │
                        │  │   events (append-only, redacted) ─ hash chain ─ webhooks.pump      │
                        │  │   controls: operators · approvals · policy · screening · demoGuard │
                        │  │   risk.assess (derived on read) · analytics · exports (Nacha/pain) │
                        │  │   http: /api/v1/* · /webhooks/inbox · /vapi/webhook · /portal/*   │
                        │  └──────────────────────────────────────────────────────────────────┘
                        │                                   │ signed POST (Landed-Signature)
                        └───────────────────────────────────▼──────── customer webhook receivers
```

## Layers

| Layer | Modules | Can it release money? |
|---|---|---|
| **Boundary (frozen core)** | `guard.ts` (pure `canPay`, `canRelease`, transitions), `payments.ts` (`send` is the only writer of `payments`), `cases.ts` (`tryRelease`, `exceptionalRelease`), `probes.ts`, `confirmations.ts`, `bankAccounts.ts`, `contacts.ts`, `timers.ts`, `clock.ts`, `events.ts`, `crypto.ts`, `schema.ts` | Yes, and only here. Changes require a failing test first and a `core:`/`core-fix:` commit. |
| **Controls** | `controls/operators.ts` (roles), `controls/approvals.ts` (maker-checker), `controls/policy.ts` (dual approval, risk review, cooling-off, velocity, ACH-first, screening block), `controls/demoGuard.ts` (kill switch) | No. Policy is evaluated *inside* `payments.send` after the guard and can only add refusals. |
| **Intelligence** | `risk/score.ts` (pure, 16 signals), `risk/assess.ts` (derived from stored facts, never written), `screening/` (Jaro-Winkler + token sort, watchlist, review), `extractors/` (rules or Claude), `explain.ts`, `packageProse.ts` | No. The LLM paths cannot import or schedule any release function (static test). |
| **Channels and rails** | `channels/` (SimVoice, Vapi+Cartesia, portal), `rails/` (Sim ledger, Capital One Nessie) | No. They record statements; `canRelease` decides. |
| **Integration** | `apiRoutes.ts` + `api/` (keys, OpenAPI, util), `webhooks/dispatch.ts`, `exports/` (Nacha, pain.001, payment files) | No. The API calls the same mutations as the dashboard; `POST /payments` gets the same 409 a clerk gets. |
| **Read models** | `analytics.ts`, `paymentRun.ts`, `paymentQueries.ts`, `audit.ts`, `evalQueries.ts` | No. Queries only. |

## Data model (28 tables)

Core: `company`, `clock`, `vendors`, `contacts` (trust level `record` / `discovered` / `untrusted`), `bankAccounts` (versioned by `identityKey = vendorId:accountHash`; `accountCiphertext` server-only), `messages`, `invoices` (`open` / `held` / `paid`), `cases` (state machine), `probes` (`amountCents` is the secret), `confirmations`, `payments` (`landingState`), `events` (append-only), `timers`, `packages`, `portalCredentials`, `portalSessions`, `confirmTokens`, `simLedger`, `evalRuns`, `settings`.

Controls and integration (added in the post-hackathon build): `operators`, `approvals`, `screenings`, `voiceCalls` (binds Vapi webhooks to calls we placed), `apiKeys` (SHA-256 of the key), `apiRequests` (idempotency, 24 h), `webhookEndpoints` (secret server-only), `webhookDeliveries`, `webhookInbox` (demo receiver), `paymentFiles` (full file in storage, masked preview in the row).

## The payment boundary, step by step

`payments.send(invoiceId, initiatedBy, rail)`:

1. Idempotency: a prior payment for `invoice + destination` returns the existing row, no rail call.
2. `canPay`: invoice exists and is open/held; destination exists, belongs to the invoice's vendor, is not disputed or superseded, **is `verified`**, and is the current version of its identity. Any thrown error is a refusal.
3. Policy (`controls/policy.ts`), same transaction: screening block → ACH-first for a never-paid account → cooling-off since verification → rolling 24 h vendor limit → approvals (amount threshold or risk score). The first failing control is the reason.
4. Insert the payment, mark the invoice paid, consume the approval if one was used, create landing timers (bound to the case for a case's first payment), schedule the rail submission.
5. Refusals are **returned** (`{ ok: false, reason }`), never thrown, so the `payment_refused` audit event commits.

The release gate `cases.tryRelease` is the mirror image on the verification side: a confirmation is accepted only if it is bound to this case, vendor, account hash and version, this probe, the probe is available, the contact is `record` *now*, the confirmation is accepted and unused, and the stated amount equals the probe amount. Acceptance and contact checks run **before** the amount comparison so an unaccepted statement can never learn whether it guessed right.

## Risk engine

`risk/score.ts` is a pure function over the stored request: email authentication, lookalike sender, reply-to mismatch, phone changed with the bank, urgency and secrecy language, off-hours send, amount at stake, vendor tenure, repeated changes, ABA checksum, bank change, emailed receipt claims, validation-provider mismatch, **account reused across vendors** (mule pattern), manual edit without a document. Each signal carries its evidence; the score is derived on read, so it always reflects the current facts and is reproducible by an auditor. It informs people and the policy threshold; it has no write path.

## Controls

* **Operators** are a role table (`clerk`, `approver`, `admin`) linked to Convex Auth users (`users.operatorId`). An admin invites an operator by email; sign-up with that email links the account (the first user of an empty deployment bootstraps the admin). `controls/actor.ts` → `requireActor(ctx, roles?)` resolves the session to an active operator inside every mutation and action, and enforces who may approve, change policy, mint keys or manage endpoints, and that a requester never approves their own request. No function takes an operator id from the client (a static test enforces this). SSO would replace the Password provider without changing a rule.
* **Approvals** bind one invoice to one destination; `payments.send` consumes exactly one.
* **Policy** is a JSON setting with validated fields, off by default, with a “recommended” preset. Every change is an audit event with before/after.
* **Screening** runs at vendor onboarding and on demand; dispositions are human and audited; the policy can refuse payments while a hit is open.
* **Demo controls kill switch**: an admin can disable clock, simulated answers and re-seed on a deployment.

## Integration

* **REST v1** (`/api/v1/*`): Bearer keys with scopes, `Idempotency-Key` (24 h replay, 409 on body mismatch), cursor pagination, typed errors, 600 req/min per key, OpenAPI 3.1 at `/api/v1/openapi.json`.
* **Webhooks**: every audit event is a candidate; endpoints subscribe by type; deliveries are signed `Landed-Signature: t=…,v1=HMAC-SHA256("{t}.{body}")` and retried at 1 m, 10 m, 1 h, 4 h, 12 h, 24 h, 72 h; private hosts are refused; a built-in signed inbox demonstrates the receiver side.
* **Payment files**: Nacha ACH (94-character records, SEC CCD/PPD/CTX, entry hash, blocking factor 10, Micro-Entry `ACCTVERIFY` builder) and ISO 20022 `pain.001.001.03`, built only from lines the guard and policy would pay now; the full file stays server-side and is fetched with a `files:read` key.
* **Voice**: Vapi with a Cartesia voice; the assistant never receives the amount; the webhook requires a shared secret and binds only to calls Landed placed.

## Time

All deadlines are rows in `timers` on the application clock (`clock.ts`); one `tick` (cron every 30 s, or a demo fast-forward) fires what is due, with per-timer error isolation. This is what makes the 40-run scenario suite deterministic.

## Testing

* `web/tests/` (vitest + convex-test, in-memory): guard property tests, invariants, policy, risk, screening, payment files, API and webhooks, hardening, labels for every enum.
* `eval/` (Python): 28 scenarios × extractor on/off, run against a real deployment through `/eval/*`; results feed README and DEVPOST through `web/scripts/sync-measured.mjs`, and the gate fails on drift.
* `scripts/verify.sh`: vitest → eval → measured-numbers check → `next build`.
