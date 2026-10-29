"""Declarative registry of the public datasets the Landed risk model is trained on.

Every entry was verified against the Hugging Face Hub / Kaggle metadata API on 2026-10-28
(file names, licenses, label columns). Nothing here is downloaded at import time; see fetch.py.

Licenses matter: IEEE-CIS, BAF (Feedzai) and SAML-D are non-commercial and are deliberately absent.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    key: str
    kind: str                      # "hf_file" | "kaggle"
    repo: str                      # Hugging Face dataset repo id, or Kaggle "owner/slug"
    files: tuple[str, ...]         # exact file names inside the repo / download
    license: str
    citation: str
    label_col: str | None          # column holding the label (None for unlabeled extras)
    label_pos: object              # value that means "positive" (fraud / phishing / laundering)
    domain: str                    # what the rows are, in one phrase
    upstream: str | None = None    # where the HF mirror comes from
    fallback: "Source | None" = None
    optional: bool = False


PAYSIM_KAGGLE = Source(
    key="paysim",
    kind="kaggle",
    repo="ealaxi/paysim1",
    files=("PS_20174392719_1491204439457_log.csv",),
    license="CC BY-SA 4.0",
    citation="Lopez-Rojas, Elmir, Axelsson (2016). PaySim: a financial mobile money simulator for fraud detection. EMSS.",
    label_col="isFraud",
    label_pos=1,
    domain="synthetic mobile-money transfers (payer, beneficiary, amount, hourly step, type)",
)

SOURCES: dict[str, Source] = {
    "paysim": Source(
        key="paysim",
        kind="hf_file",
        repo="theman10/paysim",
        files=("paysim.csv",),
        license="CC BY-SA 4.0 (upstream Kaggle ealaxi/paysim1 governs; the mirror's MIT tag does not)",
        citation=PAYSIM_KAGGLE.citation,
        label_col="isFraud",
        label_pos=1,
        domain=PAYSIM_KAGGLE.domain,
        upstream="kaggle:ealaxi/paysim1",
        fallback=PAYSIM_KAGGLE,
    ),
    "sparkov": Source(
        key="sparkov",
        kind="hf_file",
        repo="pointe77/credit-card-transaction",
        files=("credit_card_transaction_train.csv", "credit_card_transaction_test.csv"),
        license="CC0 1.0 (upstream Kaggle kartik2112/fraud-detection)",
        citation="Shenoy, K. (2020). Credit Card Transactions Fraud Detection Dataset, generated with Sparkov (Harris, B.).",
        label_col="is_fraud",
        label_pos=1,
        domain="synthetic card transactions with merchant, category, timestamp, 1,000 payers x 800 merchants, 2019-2020",
        upstream="kaggle:kartik2112/fraud-detection",
    ),
    "ibm_aml": Source(
        key="ibm_aml",
        kind="hf_file",
        repo="OsamaMIT/IBM-AML-HI-Small",
        files=("HI-Small_Trans.csv",),
        license="CDLA-Sharing 1.0",
        citation="Altman, E. et al. (2023). Realistic Synthetic Financial Transactions for Anti-Money Laundering Models. NeurIPS Datasets and Benchmarks.",
        label_col="Is Laundering",
        label_pos=1,
        domain="synthetic entity-to-entity payments with rail (ACH, Wire, Cheque...) and laundering typologies",
        upstream="kaggle:ealtman2019/ibm-transactions-for-anti-money-laundering-aml",
        optional=True,
    ),
    "phishing": Source(
        key="phishing",
        kind="hf_file",
        repo="zefang-liu/phishing-email-dataset",
        files=("Phishing_Email.csv",),
        license="LGPL-3.0",
        citation="Kaggle subhajournal/phishingemails, mirrored by zefang-liu. Enron-derived ham plus phishing bodies.",
        label_col="Email Type",
        label_pos="Phishing Email",
        domain="email bodies labelled phishing / safe",
        upstream="kaggle:subhajournal/phishingemails",
    ),
    "clair": Source(
        key="clair",
        kind="hf_file",
        repo="tasksource/CLAIR_email_fraud",
        files=("train.json", "dev.json", "test.json"),
        license="CC BY 3.0",
        citation="Radev, D. (2008). CLAIR collection of fraud email (419 / advance-fee scams).",
        label_col="label",
        label_pos="FRAUD",
        domain="payment-pressure scam emails vs. ordinary email",
    ),
}


def ordered(keys: list[str] | None = None, skip_optional: bool = False) -> list[Source]:
    out = []
    for k, s in SOURCES.items():
        if keys and k not in keys:
            continue
        if skip_optional and s.optional:
            continue
        out.append(s)
    return out
