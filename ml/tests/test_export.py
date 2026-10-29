import json
import sys
from pathlib import Path

import numpy as np
import pytest

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
from export import score_transaction_exported  # noqa: E402
from features import FEATURE_NAMES  # noqa: E402
from text import score_exported  # noqa: E402

ART = ML / "artifacts"
needs_artifacts = pytest.mark.skipif(not (ART / "transaction_lr.json").exists(), reason="run `make -C ml export` first")


def test_exported_scorer_is_a_standardised_dot_product():
    w = {"intercept": 0.5, "features": [{"name": "a", "mean": 1.0, "std": 2.0, "coef": 3.0}, {"name": "b", "mean": 0.0, "std": 1.0, "coef": -1.0}]}
    s = score_transaction_exported(w, [3.0, 2.0])
    assert s["logit"] == 0.5 + 3.0 * (3.0 - 1.0) / 2.0 - 2.0
    assert abs(s["probability"] - 1 / (1 + np.exp(-s["logit"]))) < 1e-15
    assert s["contributions"] == [3.0, -2.0]


@needs_artifacts
def test_exported_bundles_have_expected_shape_and_size():
    tx = json.loads((ART / "transaction_lr.json").read_text())
    assert [f["name"] for f in tx["features"]] == FEATURE_NAMES
    assert tx["calibration"]["method"] == "platt" and 0 < tx["threshold"] < 1
    assert all(f["std"] > 0 for f in tx["features"])
    txt = json.loads((ART / "email_tfidf_lr.json").read_text())
    assert len(txt["vocab"]) == len(txt["idf"]) == len(txt["coef"]) <= 3000
    assert txt["tokenizer"] == "ascii_word2plus_v1" and txt["ngram"] == [1, 2]
    assert (ART / "email_tfidf_lr.json").stat().st_size < 150 * 1024
    assert (ART / "transaction_lr.json").stat().st_size < 8 * 1024


@needs_artifacts
def test_parity_fixtures_match_exported_scorers():
    fx = ML.parent / "web" / "tests" / "fixtures" / "model-parity"
    tx = json.loads((ART / "transaction_lr.json").read_text())
    txt = json.loads((ART / "email_tfidf_lr.json").read_text())
    t = json.loads((fx / "transaction.json").read_text())
    assert t["version"] == tx["version"] and len(t["cases"]) == 50
    for c in t["cases"]:
        assert abs(score_transaction_exported(tx, c["features"])["probability"] - c["probability"]) < 1e-12
    e = json.loads((fx / "text.json").read_text())
    assert e["version"] == txt["version"] and len(e["cases"]) == 50
    for c in e["cases"]:
        assert abs(score_exported(txt, c["text"]) - c["probability"]) < 1e-12
