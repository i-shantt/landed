#!/usr/bin/env python
"""Render artifacts/MODEL_CARD.md from metrics.json and data/MANIFEST.json."""
from __future__ import annotations

import json
from pathlib import Path

ML = Path(__file__).resolve().parent
ART = ML / "artifacts"


def pct(x):
    return "n/a" if x is None else f"{100 * x:.2f}%"


def f3(x):
    return "n/a" if x is None else f"{x:.3f}"


def main() -> int:
    m = json.loads((ART / "metrics.json").read_text())
    manifest = json.loads((ML / "data" / "MANIFEST.json").read_text())
    tx = json.loads((ART / "transaction_lr.json").read_text())
    txt = json.loads((ART / "email_tfidf_lr.json").read_text())
    L = []
    L.append("# Model card: Landed risk models\n")
    L.append("Two logistic-regression models trained offline on public datasets and scored in TypeScript inside Convex (`web/convex/risk/model/`). They raise the attention score shown to operators and can push a payment to review through policy. **They have no write path and cannot release money**; the payment boundary (`guard.ts`, `payments.send`) does not import them (enforced by `web/tests/modelCannotRelease.test.ts`).\n")
    L.append(f"- Transaction model version `{tx['version']}`, {len(tx['features'])} features, threshold {tx['threshold']}, Platt calibration a={tx['calibration']['a']}, b={tx['calibration']['b']}.")
    L.append(f"- Email text model version `{txt['version']}`, tokenizer `{txt['tokenizer']}`, {len(txt['vocab'])} uni/bigrams, threshold {txt['threshold']}.")
    L.append(f"- Seed {m['seed']}; operating threshold chosen on the validation window by minimising expected cost with C_FN/C_FP = {m['cost_ratio']:.0f} (transactions) and 5 (emails).\n")

    L.append("## Training data\n")
    L.append("| key | rows | positives | prevalence | license | files |")
    L.append("|---|---:|---:|---:|---|---|")
    for k, s in sorted(manifest["sources"].items()):
        lab = s.get("label", {})
        L.append(f"| `{k}` ({s['repo']}) | {s['rows']:,} | {lab.get('positives', 0):,} | {pct(lab.get('prevalence'))} | {s['license']} | {', '.join(f['name'] for f in s['files'])} |")
    L.append("")
    L.append("PaySim is restricted to TRANSFER and CASH_OUT (the only types with fraud); its balance columns are label leakage and are never read. Splits are by time: PaySim step ≤500 / 501–600 / 601–744, Sparkov before 2020-03-01 / after / the official test file. Logistic regression is fitted on train-window negatives downsampled 20:1 with balanced class weights; validation and test windows are never subsampled.\n")

    L.append("## Transaction model: held-out results (test windows)\n")
    L.append("| source | model | ROC-AUC | PR-AUC | recall @ FPR 1% | recall @ FPR 5% | precision @ 100 | Brier | review rate @ thr | recall @ thr |")
    L.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for src, e in sorted(m["transaction"].items()):
        for kind in ("lr", "gbm"):
            if kind not in e:
                continue
            t = e[kind]["test"]; at = t.get("at_threshold", {})
            L.append(f"| {src} | {'LR (shipped)' if kind == 'lr' and src == 'combined' else kind.upper()} | {f3(t['roc_auc'])} | {f3(t['pr_auc'])} | {f3(t['recall_at_fpr_1pct'])} | {f3(t['recall_at_fpr_5pct'])} | {f3(t['precision_at_100'])} | {t['brier']:.4f} | {pct(at.get('review_rate'))} | {f3(at.get('recall'))} |")
    L.append("")
    L.append("HistGradientBoosting is reported as the ceiling a tree model reaches on the same features; only the logistic regression is exported because its score is a dot product that TypeScript reproduces exactly and that yields per-feature contributions.\n")

    L.append("## Email text model: held-out results\n")
    t = m["text"]
    L.append("| slice | n | ROC-AUC | PR-AUC | recall @ thr | precision @ thr |")
    L.append("|---|---:|---:|---:|---:|---:|")
    for key, label in (("test", "all"), ("test_phishing", "phishing corpus"), ("test_clair", "CLAIR scam corpus")):
        e = t[key]; at = e["at_threshold"]
        L.append(f"| {label} | {e['n']:,} | {f3(e['roc_auc'])} | {f3(e['pr_auc'])} | {f3(at['recall'])} | {f3(at['precision'])} |")
    L.append("")

    if "ap_scenarios" in m:
        s = m["ap_scenarios"]
        L.append("## Accounts-payable scenarios (synthetic, reported separately)\n")
        L.append(s["note"] + "\n")
        L.append("| scenario | n | recall @ shipped threshold | mean probability |")
        L.append("|---|---:|---:|---:|")
        for k, v in s["per_scenario"].items():
            L.append(f"| `{k}` | {v['n']} | {f3(v['recall'])} | {f3(v['mean_probability'])} |")
        L.append(f"\nBenign false-positive rate at the shipped thresholds: transactions {pct(s['benign_fpr_transactions'])}, emails {pct(s['benign_fpr_emails'])} ({s['payments']:,} payments across {s['vendors']} vendors over {s['months']} months, {s['emails']} emails).\n")

    L.append("## Caveats\n")
    L.extend([
        "1. **Domain shift.** PaySim is mobile money and Sparkov is card spend; neither is accounts payable. The model learns generic behaviour (new beneficiary, amount vs. baseline, velocity, off-hours, just-under-threshold), not AP fraud. Treat probabilities as attention scores.",
        "2. **Synthetic sources.** Both transaction datasets are simulations; PaySim's hour-of-day is a synthetic artefact and PaySim fraud prevalence rises sharply in the final steps (test window prevalence 3.7% vs 0.2% in training), which inflates PR-AUC on that split relative to real life.",
        "3. **Payer features are degenerate on PaySim** (payer ids are near-unique), so payer-side baselines are learned mostly from Sparkov.",
        "4. **Calibration transfers poorly across prevalence.** Platt parameters were fitted on the validation window; Landed's real base rate is unknown and far lower, so the policy threshold is a knob, not a probability promise.",
        "5. **Text model.** Trained on phishing and advance-fee scam corpora, not on business email compromise. It detects urgency, secrecy and payment-redirect language; it does not detect a clean, well-written redirect from a compromised real mailbox.",
        "6. **Feedback loop.** The model never sees Landed's outcomes; retraining is a manual `make -C ml all`. Operator dispositions are not labels yet.",
        "7. **Licensing.** PaySim is CC BY-SA 4.0 (attribution: Lopez-Rojas, Elmir, Axelsson 2016). Exported weights derived from it are published in this repository under the same attribution; Sparkov is CC0; the phishing corpus is LGPL-3.0 (data only); CLAIR is CC BY 3.0.",
    ])
    L.append("\n## Reproduce\n\n```bash\nmake -C ml all   # downloads public data, trains, evaluates, exports weights + parity fixtures, renders this card\n```\n")
    (ART / "MODEL_CARD.md").write_text("\n".join(L))
    print("wrote", ART / "MODEL_CARD.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
