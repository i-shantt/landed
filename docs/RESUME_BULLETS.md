# Résumé bullets

Each bullet is traceable to a file or a generated number. Numbers are as of 2026-10-29; re-check `README.md` (measured and model blocks) before reuse.

## Software engineering

- Built **Landed**, a payment-control platform for accounts payable (Next.js 16, React 19, Convex, TypeScript) that refuses any payment to a bank account not verified for that vendor inside the database transaction; 40/40 scripted fraud and legitimate scenarios pass against a live deployment with zero false releases, including with the AI extractor disabled. (`web/convex/payments.ts`, `guard.ts`, `eval/`)
- Designed a verification engine around a probe deposit read back by the vendor's contact of record over voice (Vapi, Cartesia) or a vendor portal, with a 16-check release gate, SLA timers and landing confirmation; a static test proves the AI paths cannot import or schedule any release function. (`web/convex/cases.ts`, `channels/`, `tests/security.test.ts`)
- Shipped email + password authentication (Convex Auth) with invite-by-email, server-resolved operator roles, maker-checker approvals and segregation of duties; removed every client-supplied identity argument from 19 functions and enforced it with a static test. (`web/convex/controls/actor.ts`, `auth.ts`)
- Exposed a REST API v1 (scoped hashed keys, idempotency, cursor pagination, OpenAPI 3.1) and HMAC-signed webhooks with exponential retries and an SSRF guard; generated Nacha ACH and ISO 20022 `pain.001` files from guard-approved lines only. (`web/convex/apiRoutes.ts`, `webhooks/`, `exports/`)
- Established a quality gate (268 vitest invariant tests in an in-memory Convex, a 40-run scenario suite, drift checks that regenerate the README's numbers from artifacts, Playwright smoke) and CI on GitHub Actions; documented 20 controls against SOC 2, NIST CSF 2.0 and COSO with the test that proves each. (`scripts/verify.sh`, `.github/workflows/`, `/compliance`)
- Hardened after an external-style review: closed a probe-amount oracle, bound voice webhooks to calls the system placed, encrypted account numbers at rest (HMAC + AES-256-GCM) and kept them out of the browser; append-only audit log with a hash chain. (`SECURITY.md`, `CHANGELOG.md`)

## Data / ML

- Trained and shipped a learned risk layer for accounts payable: a logistic-regression transaction model over 20 behavioural features (velocity, amount vs. beneficiary and payer medians, beneficiary age, structuring proximity) on 4.6 M public PaySim and Sparkov rows with leakage-free time splits; held-out ROC-AUC 0.877 combined (0.861 PaySim, 0.923 Sparkov), with a gradient-boosted ceiling (0.980) reported alongside. (`ml/train.py`, `ml/artifacts/metrics.json`)
- Built a TF-IDF (3,000 uni/bigrams) + logistic-regression email model on 27.8 k phishing and advance-fee emails (test ROC-AUC 0.995) with an ASCII tokenizer that TypeScript reproduces exactly; 100 parity fixtures match the Python scores to 1e-6 so the exported JSON weights are the cross-language contract. (`ml/text.py`, `web/convex/risk/model/`, `web/tests/modelParity.test.ts`)
- Chose the operating threshold by minimising expected cost on validation (C_FN/C_FP = 20) and reported the implied review rate, precision@k, recall at fixed false-positive rates, Brier score and reliability bins; evaluated separately on a synthetic AP scenario set and stated plainly which families the model misses and which deterministic rules own them. (`ml/evaluate.py`, `ml/artifacts/MODEL_CARD.md`)
- Implemented transaction monitoring computed on read from each vendor's own history (robust z-score with MAD, velocity vs. weekly median, 72-hour structuring clusters under the approval threshold, dormant-vendor spikes) plus a 0–100 beneficiary trust score and a 7/30-day risk trend API. (`web/convex/monitoring/`)
- Made the pipeline reproducible: declarative data registry with resumable sha-verified fetch from Hugging Face, committed manifest and model card, `make -C ml all` reproduces `metrics.json` byte-for-byte, and a GitHub Actions workflow re-runs it on a clean runner and fails on drift. (`ml/data/`, `ml/Makefile`, `.github/workflows/ml.yml`)

## One-line project summary

Landed — payment controls for AP that make unverified bank changes unpayable at the database boundary; verification by probe deposit and contact of record, deterministic + learned risk, maker-checker controls, REST API, Nacha/ISO 20022 files; 268 tests, 40/40 scenarios, live on Vercel + Convex.
