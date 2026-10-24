# Landed

**No payment can be sent to a bank account that has not been verified for that specific vendor, even when the AI misses the email.**

Landed is a payment-control system for accounts payable, built for Cal Hacks 13.0. Business email compromise works by getting one field changed: a fraudster writes to AP from a compromised or lookalike vendor address saying "we switched banks." The invoice is real, the vendor is real, only the destination changed. Landed holds every new destination, verifies it with a randomized sub-dollar probe deposit that the vendor's **contact of record** (a phone number established at onboarding, never a contact from the request) must read back, and only then lets a payment go out. After payment it confirms the money landed; if it did not, it assembles the bank-recall and FBI IC3 response package.

The two demonstrations that matter most:

1. **AI off, clerk fooled, Pay refused.** Extractor disabled, a clerk types the fraudster's account on the vendor page, clicks Pay. The server mutation refuses: `destination_not_verified`. No AI gets a vote.
2. **Legitimate change passes.** Probe sent, vendor of record states the right amount, account verified, payment sent, landing confirmed. No manual verification.

See `DEMO.md` for the click-by-click script, `STATUS.md` for what works and how to run it, `BUILD_LOG.md` and `OPEN_QUESTIONS.md` for the build record.

## What the probe proves

"Vendor-bound account verification through a trusted contact and a transaction challenge." It proves that a contact already trusted for this vendor, reached on the established channel, can state the amount credited to the new account. It proves **control**, not legal ownership. A sub-dollar ACH credit used for account validation is a Nacha "Micro-Entry" (under $1, `ACCTVERIFY` in the company entry description, originator subject to fraud-monitoring requirements); Landed follows this as a sanctioned pattern.

## Invariants (enforced in code, each with a test)

- **I1 Payment boundary.** `payments.send` is the only function that inserts a payment. It refuses unless the destination exists, belongs to the invoice's vendor, is `verified`, and is the current version of that account identity. Fail closed.
- **I2 New destinations start unverified** and open a case, whatever path created them (intake, manual edit, seed).
- **I3 Verification is bound** to case, vendor, account hash, account version, probe, probe availability, exact amount, a contact that is `record` *now*, and an unused, unexpired confirmation. Success flips the account, marks the confirmation used, transitions the case, and logs, atomically.
- **I4 Untrusted channels cannot confirm.** Email statements are stored as rejected and never considered.
- **I5 The agent cannot release.** No LLM-calling action can reach `markVerified`, `payments.send`, `exceptionalRelease`, or account status.
- **I6 Money movement is idempotent.** Probes and payments carry deterministic idempotency keys.
- **I7 The probe amount is secret.** No public query, event, or channel configuration carries it.
- **I8 Timers are deterministic.** Every timeout is a row on the application clock, fired by one `tick`.

## What is real vs. simulated

**Real:** the Convex engine and every invariant above (serializable mutations make I3 and I6 atomic); the versioned bank-account model with HMAC hashing and AES-256-GCM encryption of account numbers; the append-only audit log with redaction; the rule-based extractor; the Claude extractor (`claude-sonnet-5-5`, tool use with a strict schema, PDFs passed as documents) when `ANTHROPIC_API_KEY` is set; the vendor portal login (bcrypt, cookie session); the eval harness and its 20 scripted scenarios run twice (extractor on, extractor off); the recovery package's deterministic fields.
**Simulated:** the bank (`SimRail`, an in-database ledger; the Capital One Nessie rail is behind the same interface and env-selected), time (a demo clock that drives ACH windows, availability, SLAs and landing deadlines), vendor answers (`SimVoice`: the eval harness or a human types what the vendor sees; Vapi voice is behind the same interface), email authentication results (seeded), and the vendor's bank statement. Every simulation is labeled on screen and in `STATUS.md`.

## Reference facts used in the UI

- BEC affected 74% of organizations in 2025, up from 63% in 2024 (2026 AFP Payments Fraud and Control Survey). 39% of organizations received genuine emails that had been intercepted by fraudsters.
- FBI IC3 2025: $3.05 billion in reported BEC losses across 24,768 complaints. The Recovery Asset Team froze $146.6 million at a 56% success rate.
- Recovery odds are best within 24 hours and collapse after 72 hours (FinCEN, Stampli guidance). Wires are irrevocable; under Nacha rules the receiving bank may return a fraudulent ACH credit but is never required to.
- The FBI's international Financial Fraud Kill Chain applies to international wires of $50,000 or more reported within 72 hours. Domestic cases should still be reported; the Recovery Asset Team also works domestic cases.
- Same Day ACH settles in three windows (1:00, 5:00, 6:00 pm ET); first-window credits must be made available by 1:30 pm receiver-local time.

## Prior art

Trouvé (SteelHacks, September 2026) does hold-by-policy plus an automated call to the number on file with a yes/no transcript judge. Landed adds the number-answer challenge, the database-enforced release gate bound to vendor and account, the landing check, the recovery package, and an eval that includes the legitimate path.

## Layout

`web/` Next.js 16 + Convex (engine in `web/convex/`, tests in `web/tests/`), `eval/` Python runner and scenarios, `fixtures/` deterministic seed data.
