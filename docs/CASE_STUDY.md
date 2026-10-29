# Landed: an engineering case study

*Payment controls for accounts payable. Solo project, October 2026 (Cal Hacks 13.0 and the weeks after). Live at https://landed-blue.vercel.app; source at https://github.com/i-shantt/landed.*

## The problem

Business email compromise against accounts payable needs one field changed. A fraudster writes from a compromised or lookalike vendor mailbox: "we switched banks, here are the new details." The invoice is real, the vendor is real, the amount is right; only the destination account is wrong. Detection tools score the email and hope the clerk listens. Once a clerk is convinced, or an extractor is wrong, nothing stands between the payment run and the fraudster's account.

Landed inverts the control. The database refuses to create a payment to a bank account that has not been verified for that specific vendor, inside the same transaction that would write it. The AI can be wrong, the clerk can be fooled, and the payment still does not leave.

## What was built

**A payment boundary.** `payments.send` is the only code path that inserts a payment. It re-reads the invoice and destination, runs a pure guard (`canPay`: the account must exist, belong to the invoice's vendor, be the current version of its identity and be `verified`), evaluates policy, and either inserts the row or appends a `payment_refused` event with the reason. Any thrown error inside the guard is a refusal. Repeat calls for the same invoice and destination are idempotent and never touch the rail. Twelve files form this frozen core; they change only with a failing test committed first.

**A verification engine.** Every bank change opens a case: invoices to that vendor are re-pointed to the new account and held, an 11–99¢ probe deposit is sent (formatted as a Nacha Micro-Entry), and the vendor's contact of record, reached on a channel established before the request (voice via Vapi and Cartesia, or a vendor portal), reads the amount back. `canRelease` checks sixteen bound facts before the account becomes `verified`. Known-bad accounts (a rejected version, or the same account under another vendor) skip the probe and go straight to a human. The probe amount lives in one table and is compared in one mutation; it never reaches prompts, tool results, events or public queries, and a static test walks the AI paths to prove they cannot import or schedule any release function.

**A controls layer.** Email and password sign-in (Convex Auth, self-hosted) resolves every mutation to an operator row with a server-enforced role; no function accepts an operator id from the client, and a static test fails if one appears. Maker-checker approvals bind one invoice to one destination and are consumed by exactly one payment. Policy (dual approval above an amount, risk review above a score, cooling-off after verification, rolling daily vendor limit, ACH-first for new accounts, block on screening hits, monitoring review) is evaluated inside the boundary after the guard and can only add refusals. Sanctions screening uses Jaro-Winkler and token-sort matching with legal-suffix normalisation; parsers for the real OFAC SDN and ALT files are included.

**Risk, learned and deterministic.** A rules engine scores each case 0–100 from sixteen signals, each with its evidence (DMARC failure, lookalike sender, reply-to mismatch, phone changed with the bank, urgency and secrecy language, ABA checksum, account reused across vendors, …). On top of it, two models trained offline in Python on public data are scored inside Convex on read: a logistic regression over twenty behavioural payment features (velocity, amount against the beneficiary's and payer's medians, beneficiary age, round amounts, just-under-threshold) and a TF-IDF text model over the request email. The model can raise attention (`combinedScore = max(rules, model)`) and never dilute a rule hit. TypeScript reproduces the Python scores on a hundred parity fixtures to 1e-6, so the exported weights file is the contract between the two languages.

**Transaction monitoring.** Nine signals evaluated against the vendor's own history, cut strictly before the candidate payment: velocity against the vendor's weekly median, robust z-score with MAD, structuring clusters just under the approval threshold within 72 hours, dormant-vendor spikes, first payment to a recently verified account, round amounts, off-hours initiation. A beneficiary trust score (0–100, four bands, audited components) and a 7/30-day risk trend are exposed in the app and the API.

**Integration surface.** A REST API v1 with scoped, hashed keys, idempotent writes, cursor pagination and an OpenAPI 3.1 document; signed outbound webhooks (`Landed-Signature`, HMAC-SHA256, timestamp tolerance, eight retries from one minute to 72 hours, SSRF guard); Nacha ACH and ISO 20022 `pain.001` payment files built only from lines that pass the guard and policy, with the full file kept server-side and a masked preview in the browser; a controls matrix mapping twenty controls to SOC 2, NIST CSF 2.0 and COSO with the test that proves each; an append-only audit log with a hash chain.

## How it was evaluated

Three independent measurements, each regenerated by the gate so the documentation cannot drift from the artifacts.

**Scenario suite.** Twenty-eight scripted scenarios (compromised inbox, lookalike sender, misdirection, recovery, legitimate change, judge-style edge cases, payment run) run against a real Convex deployment through key-gated HTTP endpoints, twelve of them twice with the extractor turned off. <!-- measured:start -->From `eval/RESULTS.md` (40 scripted runs over 28 scenarios, 12 of them with the extractor off; 40/40 passed): fraud and misdirection scenarios blocked before payment 15/15; blocked with the extractor off 9/9; false releases 0; legitimate changes landed with zero human actions other than Pay 5/5; missed instruction changes by the extractor 0; time to hold median about 900 ms wall-clock; 268 unit and invariant tests (convex-test). This paragraph is generated from `eval/results.json` by `web/scripts/sync-measured.mjs`; the gate fails if it drifts from the data the Eval page shows.<!-- measured:end -->

**Learned layer.** <!-- model-metrics:start -->Transaction model (logistic regression over 20 behavioural features, version `transaction_lr-fb38d6da`) trained on 4,622,803 public PaySim and Sparkov rows with time-based splits; held-out test ROC-AUC 0.877 / PR-AUC 0.134 combined (PaySim 0.861 / 0.440, Sparkov 0.923 / 0.155), recall 0.418 at a 1% false-positive rate; a gradient-boosted ceiling on the same features reaches ROC-AUC 0.980 / PR-AUC 0.558. Email text model (TF-IDF 3,000 uni/bigrams + logistic regression, version `email_tfidf_lr-038c0deb`) on 27,762 phishing and advance-fee scam emails: test ROC-AUC 0.995 / PR-AUC 0.993. On 7,354 synthetic accounts-payable payments (our own generator, reported separately): new-vendor payment recall 1.000, payment-redirect email recall 0.824, benign false-positive rate 7.9%. TypeScript reproduces the Python scores on 100 parity fixtures to 1e-6. This paragraph is generated from `ml/artifacts/metrics.json` by `web/scripts/sync-model-metrics.mjs`; the gate fails if it drifts.<!-- model-metrics:end -->

Reading those numbers honestly: PaySim and Sparkov are simulated consumer-payment datasets, not accounts-payable data. Logistic regression ships because its weights are a two-kilobyte dot product with per-feature contributions a reviewer can read; the gradient-boosted model is reported as the ceiling the same features could reach. The synthetic AP scenarios are generated by this project and measure agreement with their own generator; the two scenario families the transaction model misses (duplicate invoices, sub-threshold structuring) are owned by the deterministic monitoring rules, which is why both layers exist. The model informs people and the policy threshold; it has no write path and cannot release a payment.

**Browser and API smoke.** Playwright drives the sign-in gate, the demo approver's dashboard, a case's risk panel with the learned-model block, the monitoring page and sign-out against a dev deployment; a production smoke script exercises the fraud and legitimate paths end to end after every deploy.

## Decisions worth explaining

- **Enforce in the transaction, not in a service.** Convex mutations are serializable transactions; the guard reads the account's current version in the same transaction that writes the payment, so a verification that is superseded a millisecond earlier is a refusal, not a race.
- **Rules first, model on top.** Public fraud data cannot teach the facts that matter most in AP (a mule account reused across vendors, a bad routing checksum). Those are deterministic rules with evidence. The model's job is to raise attention on patterns rules do not name; it is not allowed to lower a rule score.
- **Link identities to operators instead of folding them.** Convex Auth users link to the existing operator table by email invitation, so the three foreign keys that frozen tables hold (`approvals`, `screenings`, `apiKeys`) and every audit payload kept their shape, and the identity migration touched the frozen core in two small commits.
- **Numbers come from artifacts.** The measured paragraph above is written by a script from `eval/results.json`; the model paragraph by another from `ml/artifacts/metrics.json`. The gate fails when either drifts. A manual GitHub Actions workflow reproduces the model artifacts byte-for-byte from public data on a clean runner.
- **Secrets have one home.** Account numbers are HMAC-hashed and AES-256-GCM encrypted at rest and never reach the browser; the probe amount is compared in one mutation; webhook secrets, API keys and signing keys live only in the deployment environment.

## What was deliberately not done

Convex is hosted, not self-hosted; the Docker image covers the Next.js app only. Public read queries are still callable without a session because the evaluation runner and the public pitch page rely on them; gating reads is the recorded next step. The bank rail is a simulated ledger (a Capital One Nessie adapter exists behind the same interface). The production watchlist is synthetic; the OFAC parsers are tested but no list is loaded on a schedule. Voice calls go only to numbers on an allow-list.

## By the numbers (2026-10-29)

| | |
|---|---|
| Convex backend | ~10,400 lines TypeScript, 32 tables, 19 REST routes |
| Web app | ~10,900 lines (Next.js 16, React 19, Tailwind 4) |
| Tests | 268 vitest (convex-test, in-memory), 14 Python, 40 scenario runs, 6 Playwright |
| ML pipeline | ~1,700 lines Python; 4.6 M public transactions, 27.8 k emails; reproducible with `make -C ml all` |
| Deploys | Vercel + Convex, smoke-tested after each; rollback recorded in `STATUS.md` |

Source files referenced here: `web/convex/payments.ts`, `guard.ts`, `controls/actor.ts`, `risk/`, `monitoring/`, `apiRoutes.ts`, `exports/`, `ml/`, `eval/`, `web/e2e/`, `.github/workflows/`.
