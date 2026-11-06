import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from feedback import average_precision, evaluate_feedback, load_jsonl, render, roc_auc  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
GBM = json.loads((ROOT / "web" / "convex" / "risk" / "weights" / "transaction_gbm.json").read_text())
FIXTURES = json.loads((ROOT / "web" / "tests" / "fixtures" / "model-parity" / "transaction_gbm.json").read_text())["cases"]


def rows_from_fixtures(n=40):
    cases = FIXTURES[:n]
    med = sorted(c["probability"] for c in cases)[len(cases) // 2]
    return [
        {"object": "payment_label", "id": f"p{i}", "features": c["features"], "probability": c["probability"], "linear_probability": c["probability"],
         "label": 1 if c["probability"] >= med else 0, "source": "unconfirmed" if c["probability"] >= med else "landed", "rules_flagged": c["probability"] >= med}
        for i, c in enumerate(cases)
    ]


def test_rank_metrics_on_hand_cases():
    assert roc_auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]) == 1.0
    assert roc_auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]) == 0.0
    assert roc_auc([0.5, 0.5, 0.5, 0.5], [1, 1, 0, 0]) == 0.5
    assert roc_auc([0.5, 0.6], [1, 1]) is None
    assert average_precision([0.9, 0.8, 0.2, 0.1], [1, 0, 1, 0]) == (1 / 1 + 2 / 3) / 2
    assert average_precision([0.9], [1]) is None


def test_feedback_report_rescores_features_and_separates_labels_built_from_the_scores():
    rows = rows_from_fixtures()
    rows.append({"object": "payment_label", "id": "nofeat", "features": None, "label": 1, "probability": None, "source": "fraud_reported", "rules_flagged": True})
    rep = evaluate_feedback(rows, GBM, lr_threshold=0.5)
    assert rep["n"] == 40 and rep["skipped"] == 1
    assert rep["parity_ok"] and rep["parity_max_abs_diff"] < 1e-9
    assert rep["trees"]["roc_auc"] == 1.0 and rep["trees"]["pr_auc"] == 1.0
    assert rep["rules"]["recall"] == 1.0 and rep["rules"]["fpr"] == 0.0
    assert "linear" in rep and rep["linear"]["roc_auc"] == 1.0
    assert rep["by_source"] == {"unconfirmed": rep["positives"], "landed": rep["negatives"]}
    md = render(rep, {"as_of": "2026-11-05T00:00:00Z", "source": "test"}, "x.jsonl")
    assert "| trees (shipped) | 1.000 | 1.000 |" in md
    assert "40 labelled payments" in md


def test_single_class_feedback_reports_no_auc(tmp_path):
    rows = [r for r in rows_from_fixtures() if r["label"] == 1]
    rep = evaluate_feedback(rows, GBM, lr_threshold=None)
    assert rep["trees"]["roc_auc"] is None and rep["trees"]["pr_auc"] is None
    assert "linear" not in rep
    p = tmp_path / "labels.jsonl"
    p.write_text("\n".join([json.dumps({"object": "header", "as_of": "t", "source": "s", "feature_names": GBM["features"]})] + [json.dumps(r) for r in rows]) + "\n")
    header, loaded = load_jsonl(p)
    assert header["source"] == "s" and len(loaded) == len(rows)
