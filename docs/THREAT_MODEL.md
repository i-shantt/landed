# Threat model

Scope: the deployed Landed system (Next.js on Vercel, Convex functions and storage, the REST API, the voice and portal channels, the ML
artifacts). Method: trust boundaries first, then STRIDE per boundary, each threat mapped to the control that addresses it and the test
that would fail if the control regressed. "Accepted" means the risk is known and documented in `SECURITY.md` rather than mitigated.
Companion documents: `SECURITY.md` (the public surface, function by function), `docs/CASE_STUDY.md`, `/compliance` in the app (controls matrix).

## Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| The payment boundary | `convex/payments.ts` + `guard.ts` (`canPay`) | the one place money leaves; everything else exists to keep it honest |
| Verification state | `bankAccounts.status`, set only by `cases.tryRelease` / `exceptionalRelease` | a wrong `verified` is a misdirected payment |
| Probe amounts | `probes.amountCents`, internal reads only | the secret the vendor must read back; knowing it defeats verification |
| Account numbers | HMAC-SHA256 + AES-256-GCM at rest, last four in projections | regulated PII; the thing fraud wants to swap |
| Operator identity and roles | Convex Auth tables + `operators` | segregation of duties, approvals, policy |
| API keys, webhook secrets, deployment env | SHA-256 of keys; secrets server-only; `.env.local` and the Convex env | lateral movement into the API or spoofed webhooks |
| Audit log | `events` (append-only, hash chain recomputed on read) | the evidence for every decision |
| Model weights and training reference | `convex/risk/weights/*.json` (committed) | a tampered model mis-ranks risk, though it still cannot release |

## Trust boundaries

```
 untrusted inbound                    Landed (Convex)                           outbound
 ─────────────────                    ───────────────                           ────────
 B1 operator browser  ──session──▶  controls/actor.ts → mutations
 B2 email, PDFs, EML  ──intake───▶  extractors (LLM or rules) → cases only
 B3 vendor voice/portal ─webhook─▶  channels/* → confirmations → canRelease
 B4 REST clients      ──bearer───▶  apiRoutes.ts → the same mutations
 B5 eval / demo tools ──x-eval-key▶ http.ts /eval/*                          B6 webhooks → customer URLs
 B7 ML artifacts      ──commit────▶ risk/model (read-only scorer)             B8 payment files → storage → files:read key
```

## STRIDE by boundary

### B1. Operator browser → Convex (session, roles)

| Threat | Control | Proof |
|---|---|---|
| **S** a client names another operator | no function takes an `operatorId` argument; identity comes from the session | `security.test.ts` "no function takes a client-supplied operator id"; `auth.test.ts` "no identity and no operatorId -> unauthenticated" |
| **S** sign-up by an uninvited email | sign-up succeeds only for an invited (active, unlinked) operator email; first user of an empty deployment bootstraps admin once | `auth.test.ts` "an unknown email is refused when users already exist" |
| **E** a clerk changes policy or approves their own request | role check on the server; segregation of duties in `approvals.decide` | `auth.test.ts` "a clerk cannot change policy", "the requester cannot approve their own request" |
| **E** a deactivated operator keeps a live session | `requireActor` re-reads `active` on every call | `auth.test.ts` "a deactivated operator is refused on the next call" |
| **T** approval used as a substitute for verification | approval is consumed only after `canPay` passes, inside `payments.send` | `policy.test.ts`, `auth.test.ts` "the approval is consumed by send" |
| **I** public queries readable without a session | accepted for now (eval runner, `/pitch`, `/health` rely on them); projections never carry ciphertext, hashes, probe amounts or key material | `invariants.test.ts` 11–12; `hardening2.test.ts` "probe transcripts are never returned to the browser" |
| **R** an action without an actor | every state change appends an event with actor and operator name | `audit.chain` recomputed; `auth.test.ts` "the audit payload names them" |

### B2. Inbound documents → intake (LLM and rules extractors)

| Threat | Control | Proof |
|---|---|---|
| **E** prompt injection in an email reaches payment or release | extractors can only open cases and hold invoices; static test forbids imports of release or payment functions from AI paths (I5) | `security.test.ts` "only cases.ts flips an account to verified", "only payments.ts inserts payments" |
| **T** a crafted message asserts a trusted sender | DMARC and header results are taken from headers or reported absent, never assumed; sender trust is not a release input | `eml.test.ts`; `risk.test.ts` |
| **D** a poison message wedges intake | `intake.run` marks the message `error` instead of leaving it pending; timers isolate failures | `hardening2.test.ts` "fail closed without EVAL_KEY and validate numeric input"; `clock.test.ts` |
| **S** an account hidden in a PDF footer slips through as benign | both extractors scored 1.00 / 1.00 on the hand-written set including that case; 200 generated benign emails give zero false positives | `hardening.test.ts` "200 generated benign emails" |

### B3. Vendor channels → confirmations → release gate

| Threat | Control | Proof |
|---|---|---|
| **S** a forged Vapi webhook | shared secret required (fails closed when unset); the case and contact are resolved server-side from the call Landed placed, body metadata is forensic only | `hardening2.test.ts` "rejects a request without the shared secret", "ignores metadata from the body" |
| **I** the assistant reads the probe amount aloud | leak check on assistant turns and tool notes; a leak re-issues the probe once, a second escalates | `hardening2.test.ts` "an assistant leak re-issues the probe once" |
| **I** amount oracle through refusal reasons | `canRelease` checks acceptance and contact before comparing amounts; unaccepted statements never reach the gate | `hardening2.test.ts` "canRelease reports acceptance/contact problems before it ever compares amounts"; `properties.test.ts` "no amount oracle" (fast-check, every stated amount) |
| **T** replayed or re-bound confirmation | sixteen bound checks (case, vendor, hash, version, probe, availability, acceptance, single use, contact of record, amount, timing) | `canRelease.test.ts` (one per reason); `properties.test.ts` "every single perturbation refuses"; `invariants.test.ts` 3, 4, 6, 7, 8 |
| **S** a discovered or email contact confirms | only `trustLevel: "record"` contacts count; email-channel statements are stored rejected (I4) | `invariants.test.ts` "I4", `security.test.ts` "trust level 'record' is only written by…" |
| **D** portal credential guessing | bcrypt, lockout after 5 failures per username, server-side attempt counting, expiring sessions and tokens | `portalHardening.test.ts` |
| **E** a known-bad or reused account number gets a probe | rejected/disputed numbers and numbers seen under another vendor skip the probe and go straight to a human | `hardening2.test.ts` "mule pattern", "previously rejected account number" |

### B4. REST API clients

| Threat | Control | Proof |
|---|---|---|
| **S** stolen or guessed key | 48-hex random keys, SHA-256 at rest, plaintext shown once, revocation immediate | `api.test.ts` "rejects missing, malformed, unknown and revoked keys" |
| **E** a read key writes | per-route scopes | `api.test.ts` "enforces scopes"; "only an admin can mint keys" |
| **T** a replayed POST | `Idempotency-Key` replays the stored response, a different body is a 409 | `api.test.ts` "Idempotency-Key replays the stored response" |
| **E** the API bypasses the boundary | every write calls the same mutation the dashboard calls; a payment to an unverified destination is 409 with the guard's reason | `api.test.ts` "the payment endpoint is refused by the same boundary" |
| **D** bursts | token bucket per key (600/min); a burst the bucket cannot serialise answers 429, not 500 (found by `scripts/bench-api.mjs`) | `rateLimit.test.ts`; `docs/BENCHMARKS.md` |
| **I** account numbers in payment files | files are built from guard-approved lines only, stored in Convex storage, served only to a `files:read` key; the browser gets a masked preview | `paymentFiles.test.ts` "masking…"; `auth.test.ts` "paymentFiles.build" |

### B5. Eval and demo surface

| Threat | Control | Proof |
|---|---|---|
| **E** `/eval/*` reachable without the key | constant-time compare against `EVAL_KEY`; a deployment without the key has no `/eval/*` at all | `hardening2.test.ts` "fail closed without EVAL_KEY" |
| **I** the test-only probe-amount route on prod | exists only when `EVAL_PROBE_AMOUNT_ENDPOINT=1`; prod returns 404 | `scripts/checkpoint2.mjs --prod` checks it |
| **T** demo controls (clock, simulated answers, reseed) abused | admin kill switch; reseed never touches users, sessions or operators | `demoControls.test.ts`; `auth.test.ts` "reseed never touches users" |

### B6. Outbound webhooks

| Threat | Control | Proof |
|---|---|---|
| **S** a receiver cannot tell Landed's events from forged ones | `Landed-Signature: t=…,v1=HMAC-SHA256`, rotation tolerated, stale timestamps rejected | `api.test.ts` "signature scheme round-trips, tolerates rotation and rejects stale or forged headers" |
| **E** SSRF through an endpoint URL | HTTPS only; private, loopback and link-local hosts refused | `api.test.ts` "refuses private and plaintext endpoint URLs" |
| **I** payload leaks | payloads are the redacted audit payloads | `invariants.test.ts` 11 |
| **D** a dead receiver | bounded exponential retries, deliveries recorded | `api.test.ts` "failures back off" |

### B7. ML artifacts and datasets

| Threat | Control | Proof |
|---|---|---|
| **E** the model releases or pays | `risk/` and `monitoring/` never write, schedule or call mutations; the frozen boundary does not import them; weights are data, not code | `modelCannotRelease.test.ts` (static walker) |
| **T** weights edited by hand | fixtures scored by Python from the exported JSON must match TypeScript to 1e-6 (trees 1e-9); CI re-runs the pipeline on a clean runner | `modelParity.test.ts`; `.github/workflows/ml.yml` |
| **T** poisoned public datasets | downloads land in gitignored directories, are sha-verified against the committed manifest and never imported as code (`python -I`) | `ml/tests/test_fetch.py` |
| **I** silent degradation in production | model health on read: score stability (PSI), shift from the training reference, per-feature drift, agreement with the glass-box baseline | `drift.test.ts`; `monitoringPolicy.test.ts` "model health" |

### B8. Infrastructure and secrets

| Threat | Control | Proof |
|---|---|---|
| **I** secrets in git | `.env.local` gitignored; keys synced to deployments by `scripts/sync-env.mjs`; the OpenAPI document and `/health` expose presence as booleans only | `security.test.ts`; `health.status` |
| **T** dependency vulnerabilities | CI fails on high or critical advisories in production npm dependencies and on any known vulnerability in the ML environment (`pip-audit`); CodeQL on push and weekly | `.github/workflows/ci.yml` (security job), `codeql.yml` |
| **T** lockfile drift between macOS and Linux | CI installs with `npm ci`; the nested `@emnapi` entries are restored after local installs (documented in `CONTRIBUTING.md`) | the `web` CI job |
| **R** who deployed what | `STATUS.md` records each deployment id and functions commit; rollback commands kept | process |

## Residual risks (accepted, documented)

- Public read queries (see B1). Gating reads behind the session is the next change; the eval runner would then use the key-gated routes.
- Demo accounts are public by design; the approver role cannot change policy, keys, webhooks, operators or the kill switch.
- The portal login is a seeded credential table, not an identity provider; a production deployment would front it with the vendor's SSO.
- Public Convex functions used by the portal are rate-limited only through the HTTP routes; the per-username lockout still bounds guessing.
- The learned model is trained on public consumer-payment data, not accounts-payable traffic; the domain shift is declared in the model card and tracked by the drift monitor, and the model never decides a release.
