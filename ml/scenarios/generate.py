#!/usr/bin/env python
"""Synthetic accounts-payable scenario set for a held-out check of the shipped models.

No public dataset of AP fraud exists, so these are generated (seed 1300) and reported SEPARATELY from the
public-data metrics as "agreement with our own generator". 200 vendors, 24 months of benign payments,
injected scenarios at ~1.5% of payments (prevalence anchored on AFP/APQC payment-fraud survey ranges).

Scenarios:
  bank_change_then_pay        first payment to a never-paid destination right after a bank change (new beneficiary, often off-hours)
  duplicate_invoice           the same amount to the same vendor within 48 h
  sub_threshold_structuring   two or three payments each just under the dual-approval threshold within 72 h
  new_vendor_payment          large round-amount payment to a vendor onboarded this week
  lookalike_domain_request    email text: urgent payment-redirect request (text model)

Outputs artifacts/metrics.json["ap_scenarios"] (per-scenario recall at the shipped threshold, benign FPR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from export import score_transaction_exported  # noqa: E402
from features import DAY, HOUR, candidate_features, vector  # noqa: E402
from text import score_exported  # noqa: E402

ART = Path(__file__).resolve().parents[1] / "artifacts"
SEED = 1300
N_VENDORS = 200
MONTHS = 24
THRESHOLD = 25_000.0
T0 = 1_700_000_000  # 2023-11-14, arbitrary anchor

BENIGN_EMAILS = [
    "Hi, please find attached invoice {inv} for October services. Net 30 as usual. Thanks, {name}",
    "Following up on invoice {inv}; let us know if you need a W-9. Best, {name}",
    "Attached is the signed statement of work and the first invoice {inv}. Regards, {name}",
    "Quick reminder that invoice {inv} is due next week. Appreciate it. {name}",
    "Here is the credit memo against invoice {inv}. Thanks for your patience. {name}",
]
FRAUD_EMAILS = [
    "URGENT: our bank account has changed. Please update remittance details before paying invoice {inv} today. Confidential, do not call the office. {name}",
    "We switched banks. Wire the outstanding balance for invoice {inv} to the new account attached immediately. Please keep this between us. {name}",
    "Our CFO needs payment of invoice {inv} processed within the hour to the updated account. Reply to this email only. Thanks {name}",
    "Due to an audit our old account is frozen. Kindly remit invoice {inv} to the new banking details below asap. {name}",
    "Please treat as urgent: new wire instructions for invoice {inv}. Do not verify by phone, our lines are down. {name}",
]


def generate(rng: np.random.Generator):
    payments = []  # dicts: vendor, dest, amount, at, type, hour, weekday, label, scenario
    emails = []
    for v in range(N_VENDORS):
        onboarded = T0 - int(rng.integers(30, 5 * 365)) * DAY
        cadence = int(rng.choice([7, 14, 30, 30, 30, 60]))
        typical = float(rng.lognormal(7.5, 1.0))
        dest = f"V{v}-A0"
        t = T0 - MONTHS * 30 * DAY
        while t < T0:
            amt = max(50.0, typical * float(rng.lognormal(0, 0.25)))
            hour = int(rng.choice(range(8, 18)))
            wd = int(rng.integers(1, 6))
            payments.append(dict(vendor=v, dest=dest, amount=round(amt, 2), at=t + hour * HOUR, type="payment", hour=hour, weekday=wd, label=0, scenario="benign", onboarded=onboarded))
            t += cadence * DAY + int(rng.integers(-1, 2)) * DAY
        for _ in range(int(rng.integers(1, 4))):
            emails.append((str(rng.choice(BENIGN_EMAILS)).format(inv=int(rng.integers(1000, 9999)), name=f"Vendor {v}"), 0, "benign"))

    n_inject = int(round(0.015 * len(payments)))
    for i in range(n_inject):
        v = int(rng.integers(0, N_VENDORS)); hist = [p for p in payments if p["vendor"] == v and p["label"] == 0]
        typical = float(np.median([p["amount"] for p in hist]))
        scenario = ["bank_change_then_pay", "duplicate_invoice", "sub_threshold_structuring", "new_vendor_payment"][i % 4]
        at = T0 - int(rng.integers(0, 60)) * DAY
        if scenario == "bank_change_then_pay":
            hour = int(rng.choice([2, 4, 21, 22, 10, 15]))
            payments.append(dict(vendor=v, dest=f"V{v}-A9", amount=round(typical * float(rng.uniform(1.5, 4)), 2), at=at + hour * HOUR, type="transfer", hour=hour, weekday=int(rng.integers(0, 7)), label=1, scenario=scenario, onboarded=hist[0]["onboarded"]))
        elif scenario == "duplicate_invoice":
            base = hist[-1]
            payments.append(dict(vendor=v, dest=base["dest"], amount=base["amount"], at=base["at"] + int(rng.integers(1, 48)) * HOUR, type="payment", hour=base["hour"], weekday=base["weekday"], label=1, scenario=scenario, onboarded=base["onboarded"]))
        elif scenario == "sub_threshold_structuring":
            for k in range(int(rng.integers(2, 4))):
                payments.append(dict(vendor=v, dest=hist[0]["dest"], amount=round(THRESHOLD * float(rng.uniform(0.9, 0.99)), 2), at=at + k * int(rng.integers(6, 30)) * HOUR, type="transfer", hour=int(rng.integers(8, 18)), weekday=int(rng.integers(1, 6)), label=1, scenario=scenario, onboarded=hist[0]["onboarded"]))
        else:
            nv = N_VENDORS + i
            payments.append(dict(vendor=nv, dest=f"V{nv}-A0", amount=float(round(rng.uniform(20, 80)) * 1000), at=at + 11 * HOUR, type="transfer", hour=11, weekday=3, label=1, scenario=scenario, onboarded=at - int(rng.integers(0, 7)) * DAY))
        emails.append((str(rng.choice(FRAUD_EMAILS)).format(inv=int(rng.integers(1000, 9999)), name=f"Vendor {v}"), 1, "lookalike_domain_request"))
    payments.sort(key=lambda p: p["at"])
    return payments, emails


def score_all(payments, emails, tx, txt):
    by_vendor: dict[int, list] = {}
    by_dest: dict[str, list] = {}
    rows = []
    for p in payments:
        vh = by_vendor.get(p["vendor"], []); dh = by_dest.get(p["dest"], [])
        feats = candidate_features(amount=p["amount"], at=p["at"], hour=p["hour"], weekday=p["weekday"], type_=p["type"],
                                   bene_history=dh, payer_history=vh, pair_seen_before=bool(dh),
                                   bene_first_seen_at=(dh[0][0] if dh else None), threshold=THRESHOLD)
        s = score_transaction_exported(tx, vector(feats))
        rows.append((p["scenario"], p["label"], float(s["probability"])))
        by_vendor.setdefault(p["vendor"], []).append((p["at"], p["amount"]))
        by_dest.setdefault(p["dest"], []).append((p["at"], p["amount"]))
    for text, label, scenario in emails:
        rows.append((scenario, label, score_exported(txt, text)))
    return rows


def main() -> int:
    rng = np.random.default_rng(SEED)
    tx = json.loads((ART / "transaction_lr.json").read_text())
    txt = json.loads((ART / "email_tfidf_lr.json").read_text())
    payments, emails = generate(rng)
    rows = score_all(payments, emails, tx, txt)
    per = {}
    for scenario in sorted({s for s, _, _ in rows if s != "benign"}):
        ps = [p for s, _, p in rows if s == scenario]
        thr = txt["threshold"] if scenario == "lookalike_domain_request" else tx["threshold"]
        per[scenario] = {"n": len(ps), "recall": float(np.mean([p >= thr for p in ps])), "mean_probability": float(np.mean(ps))}
    benign_tx = [p for s, l, p in rows if s == "benign" and l == 0]
    benign_email = [p for (t, l, s), (_, _, p) in zip(emails, rows[-len(emails):]) if l == 0]
    out = {
        "note": "Synthetic AP scenarios generated by ml/scenarios/generate.py (seed 1300). These numbers measure agreement with our own generator, not performance on real AP fraud; no public AP fraud dataset exists.",
        "vendors": N_VENDORS, "months": MONTHS, "threshold_amount": THRESHOLD,
        "payments": len(payments), "injected_payments": int(sum(1 for p in payments if p["label"])), "emails": len(emails),
        "per_scenario": per,
        "benign_fpr_transactions": float(np.mean([p >= tx["threshold"] for p in benign_tx])),
        "benign_fpr_emails": float(np.mean([p >= txt["threshold"] for p in benign_email])),
    }
    m = json.loads((ART / "metrics.json").read_text())
    m["ap_scenarios"] = out
    (ART / "metrics.json").write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")
    for k, v in per.items():
        print(f"  {k:28s} n={v['n']:4d} recall={v['recall']:.3f} mean p={v['mean_probability']:.3f}")
    print(f"  benign FPR: transactions {out['benign_fpr_transactions']:.4f}, emails {out['benign_fpr_emails']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
