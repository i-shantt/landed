# ml/ — the learned layer of Landed's risk engine

Landed's risk engine is rule-based and explainable (`web/convex/risk/score.ts`). This directory adds a
learned layer next to it: two small logistic-regression models trained offline in Python on public
datasets, exported as JSON weights, and scored inside Convex in TypeScript (`web/convex/risk/model/`).
The model informs people and the policy threshold. It has no write path and cannot release money.

## One command

```bash
make -C ml all        # venv -> fetch -> features -> train -> evaluate -> scenarios -> export -> card -> sync
```

Every step is idempotent and resumable (partial downloads resume, the feature pass is cached as
parquet in `data/interim/`, seeds are fixed at 1300). `make -C ml test` runs the Python unit tests.

## Data

No raw data is committed. `data/fetch.py` downloads from Hugging Face (no token needed) with a Kaggle
fallback through `kagglehub` (public datasets need no credentials) and records sizes, sha256, row counts
and label prevalence in `data/MANIFEST.json`, which the model card reads.

| key | source | license | used for |
|---|---|---|---|
| `paysim` | `theman10/paysim` (mirror of Kaggle `ealaxi/paysim1`) | CC BY-SA 4.0 | primary transaction model: payer, beneficiary, amount, hourly step, transfer type |
| `sparkov` | `pointe77/credit-card-transaction` (mirror of Kaggle `kartik2112/fraud-detection`) | CC0 | second transaction source with real timestamps and stable payer/beneficiary baselines |
| `phishing` | `zefang-liu/phishing-email-dataset` | LGPL-3.0 | email text model, phishing vs. safe |
| `clair` | `tasksource/CLAIR_email_fraud` | CC BY 3.0 | email text model, payment-pressure scam language |
| `ibm_aml` (optional) | `OsamaMIT/IBM-AML-HI-Small` | CDLA-Sharing 1.0 | B2B rails and laundering typologies; not used by the shipped model |

IEEE-CIS, Bank Account Fraud (Feedzai) and SAML-D were considered and excluded: their licenses are
non-commercial. No public dataset of accounts-payable fraud, vendor bank-account changes or business
email compromise exists (searched 2026-10-28); the AP-specific scenarios in `scenarios/` are therefore
synthetic and are reported separately from the public-data metrics. `artifacts/MODEL_CARD.md` spells
out every caveat.

## Layout

```
data/sources.py      registry: ids, exact file names, licenses, label columns
data/fetch.py        resumable download + sha256 + MANIFEST.json
loaders.py           each source -> one canonical transaction frame (payer, beneficiary, amount, at, type, hour, weekday, label, split)
features.py          the feature contract shared with web/convex/risk/model/features.ts
text.py              tokenizer + TF-IDF pipeline shared with web/convex/risk/model/text.ts
train.py             logistic regression vs HistGradientBoosting, time-based splits
evaluate.py          ROC/PR AUC, precision@k, recall@FPR, Brier, reliability, cost-ratio threshold, SVG plots
scenarios/           synthetic AP scenario generator (held-out, labelled "agreement with our own generator")
export.py            weights -> artifacts/*.json, parity fixtures -> web/tests/fixtures/model-parity/
model_card.py        renders artifacts/MODEL_CARD.md from metrics.json + MANIFEST.json
Makefile             the pipeline
```

Raw files are untrusted data: scripts run with `python -I`, and raw files are only ever read by pandas.
