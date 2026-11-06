"""Score the shipped model on operator feedback.

Reads the JSONL written by web/scripts/export-labels.mjs (one header line, then one `payment_label` per line: the
disposition an operator or the rail produced after the payment, joined with the 20-feature vector the model saw at
send time) and reports how the shipped trees, the logistic-regression baseline and the deterministic monitoring rules
rank those labels. This is the in-domain check the public-data model card cannot give: the training data is consumer
payments, the labels here are accounts-payable outcomes.

    .venv/bin/python -I feedback.py data/feedback/labels-dev.jsonl [--out artifacts/feedback_report.md]

Honest reading: a demo deployment yields a handful of labels, almost all from scripted scenarios; the numbers are a
smoke test of the loop (features round-trip, parity holds, metrics compute), not an evaluation. The report says how
many labels it saw. Nothing here retrains or writes weights; retraining stays a deliberate `make -C ml all` with the
feedback rows added as a third source once there are enough of them.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from trees import score_trees_exported  # noqa: E402

ML = Path(__file__).resolve().parent
WEIGHTS = ML.parent / "web" / "convex" / "risk" / "weights"
MIN_PER_CLASS = 1


def load_jsonl(path: Path) -> tuple[dict, list[dict]]:
    header: dict = {}
    rows: list[dict] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if obj.get("object") == "header":
                header = obj
            else:
                rows.append(obj)
    return header, rows


def roc_auc(scores: list[float], labels: list[int]) -> float | None:
    """Mann-Whitney AUC with tie handling; None unless both classes are present."""
    pos = [s for s, y in zip(scores, labels) if y == 1]
    neg = [s for s, y in zip(scores, labels) if y == 0]
    if len(pos) < MIN_PER_CLASS or len(neg) < MIN_PER_CLASS:
        return None
    wins = 0.0
    for p in pos:
        for n in neg:
            wins += 1.0 if p > n else 0.5 if p == n else 0.0
    return wins / (len(pos) * len(neg))


def average_precision(scores: list[float], labels: list[int]) -> float | None:
    if sum(labels) == 0 or sum(labels) == len(labels):
        return None
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    tp = 0
    ap = 0.0
    for k, i in enumerate(order, start=1):
        if labels[i] == 1:
            tp += 1
            ap += tp / k
    return ap / sum(labels)


def at_threshold(flags: list[bool], labels: list[int]) -> dict:
    tp = sum(1 for f, y in zip(flags, labels) if f and y == 1)
    fp = sum(1 for f, y in zip(flags, labels) if f and y == 0)
    fn = sum(1 for f, y in zip(flags, labels) if not f and y == 1)
    tn = sum(1 for f, y in zip(flags, labels) if not f and y == 0)
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "fpr": fp / (fp + tn) if fp + tn else None,
        "flag_rate": (tp + fp) / len(labels) if labels else None,
    }


def evaluate_feedback(rows: list[dict], gbm: dict, lr_threshold: float | None, parity_tol: float = 1e-6) -> dict:
    """Pure: metrics for the trees (rescored here from the exported features), the linear baseline and the rules."""
    usable = [r for r in rows if r.get("features") is not None and r.get("label") in (0, 1)]
    skipped = len(rows) - len(usable)
    labels = [int(r["label"]) for r in usable]
    rescored = [score_trees_exported(gbm, [float(x) for x in r["features"]])["probability"] for r in usable]
    recorded = [r.get("probability") for r in usable]
    parity = max((abs(a - b) for a, b in zip(rescored, recorded) if b is not None), default=0.0)
    tree_flags = [p >= gbm["threshold"] for p in rescored]
    out = {
        "n": len(usable), "skipped": skipped, "positives": sum(labels), "negatives": len(labels) - sum(labels),
        "by_source": {},
        "parity_max_abs_diff": parity, "parity_ok": parity <= parity_tol,
        "model_version": gbm.get("version"), "threshold": gbm["threshold"],
        "trees": {"roc_auc": roc_auc(rescored, labels), "pr_auc": average_precision(rescored, labels), **at_threshold(tree_flags, labels)},
        "rules": {**at_threshold([bool(r.get("rules_flagged")) for r in usable], labels)},
    }
    for r in usable:
        out["by_source"][r.get("source", "?")] = out["by_source"].get(r.get("source", "?"), 0) + 1
    lin = [r.get("linear_probability") for r in usable]
    if lr_threshold is not None and all(v is not None for v in lin) and lin:
        out["linear"] = {"roc_auc": roc_auc(lin, labels), "pr_auc": average_precision(lin, labels), **at_threshold([v >= lr_threshold for v in lin], labels)}
    return out


def fmt(x) -> str:
    if x is None:
        return "n/a"
    return f"{x:.3f}" if isinstance(x, float) else str(x)


def render(report: dict, header: dict, source_path: str) -> str:
    def block(name: str, m: dict) -> str:
        return f"| {name} | {fmt(m.get('roc_auc'))} | {fmt(m.get('pr_auc'))} | {fmt(m.get('precision'))} | {fmt(m.get('recall'))} | {fmt(m.get('fpr'))} | {m['tp']}/{m['fp']}/{m['fn']}/{m['tn']} |"
    lines = [
        "# Operator feedback report",
        "",
        f"Source `{source_path}` exported {header.get('as_of', '?')} from `{header.get('source', '?')}`. "
        f"{report['n']} labelled payments ({report['positives']} suspicious, {report['negatives']} benign), {report['skipped']} skipped without features; "
        f"by source {json.dumps(report['by_source'])}. Shipped model `{report['model_version']}` at threshold {report['threshold']}; "
        f"features rescored here match the recorded probabilities to {report['parity_max_abs_diff']:.1e} ({'ok' if report['parity_ok'] else 'MISMATCH'}).",
        "",
        "| Scorer | ROC-AUC | PR-AUC | precision | recall | FPR | tp/fp/fn/tn |",
        "|---|---:|---:|---:|---:|---:|---:|",
        block("trees (shipped)", report["trees"]),
    ]
    if "linear" in report:
        lines.append(block("logistic regression (baseline)", report["linear"]))
    lines.append(block("monitoring rules (flagScore >= 40)", report["rules"]))
    lines += [
        "",
        "Labels come from landing state, case outcome and fraud reports, never from the model. "
        "Below a few dozen labels per class these numbers are a smoke test of the loop, not an evaluation; AUC is reported only when both classes are present.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("--weights", type=Path, default=WEIGHTS / "transaction_gbm.json")
    ap.add_argument("--linear", type=Path, default=WEIGHTS / "transaction_lr.json")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    header, rows = load_jsonl(args.jsonl)
    gbm = json.loads(args.weights.read_text())
    lr_threshold = json.loads(args.linear.read_text()).get("threshold") if args.linear.exists() else None
    report = evaluate_feedback(rows, gbm, lr_threshold)
    md = render(report, header, str(args.jsonl))
    print(md)
    if args.out:
        args.out.write_text(md)
        args.out.with_suffix(".json").write_text(json.dumps(report, indent=1) + "\n")
        print(f"wrote {args.out} and {args.out.with_suffix('.json')}")


if __name__ == "__main__":
    main()
