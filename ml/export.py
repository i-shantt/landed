#!/usr/bin/env python
"""Export the shipped models as JSON weights and write parity fixtures for the TypeScript scorer.

transaction_lr.json  {version, trained_on, features:[{name, mean, std, coef}], intercept, threshold, calibration:{method, a, b}}
email_tfidf_lr.json  {version, tokenizer, ngram, vocab[], idf[], coef[], intercept, threshold}

Fixtures are scored WITH THE ROUNDED EXPORTED JSON (not the sklearn pipeline) so the TypeScript side can
match to 1e-6 regardless of libm ulp differences; the exported-vs-sklearn gap is asserted here to < 1e-4.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import joblib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_NAMES, candidate_features, vector  # noqa: E402
from text import TOKENIZER_ID, score_exported  # noqa: E402

ML = Path(__file__).resolve().parent
ART = ML / "artifacts"
MODELS = ART / "models"
WEB = ML.parent / "web"
WEIGHTS_DIR = WEB / "convex" / "risk" / "weights"
FIXTURES_DIR = WEB / "tests" / "fixtures" / "model-parity"
ROUND = 6
SEED = 1300
SHIPPED_TRANSACTION = "combined"


def r(x: float) -> float:
    return float(round(float(x), ROUND))


def version_of(payload: dict) -> str:
    h = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:8]
    return f"{payload['family']}-{h}"


def export_transaction(metrics: dict) -> dict:
    pipe = joblib.load(MODELS / f"{SHIPPED_TRANSACTION}_lr.joblib")
    scaler = pipe.named_steps["scale"]; lr = pipe.named_steps["lr"]
    m = metrics["transaction"][SHIPPED_TRANSACTION]["lr"]
    features = [{"name": n, "mean": r(mu), "std": r(sd if sd > 0 else 1.0), "coef": r(c)}
                for n, mu, sd, c in zip(FEATURE_NAMES, scaler.mean_, scaler.scale_, lr.coef_[0])]
    payload = {"family": "transaction_lr", "trained_on": ["paysim", "sparkov"], "features": features,
               "intercept": r(lr.intercept_[0]), "threshold": r(m["threshold"]),
               "calibration": {"method": "platt", "a": r(m["platt"]["a"]), "b": r(m["platt"]["b"])}}
    payload["version"] = version_of(payload)
    return payload


def score_transaction_exported(w: dict, x: list[float]) -> dict:
    z = w["intercept"]
    contributions = []
    for f, xi in zip(w["features"], x):
        c = f["coef"] * (xi - f["mean"]) / f["std"]
        z += c
        contributions.append(c)
    return {"logit": z, "probability": 1.0 / (1.0 + np.exp(-z)), "contributions": contributions}


def export_text(metrics: dict) -> dict:
    bundle = joblib.load(MODELS / "email_tfidf_lr.joblib")
    vec, clf = bundle["vectorizer"], bundle["clf"]
    payload = {"family": "email_tfidf_lr", "tokenizer": TOKENIZER_ID, "ngram": [1, 2],
               "vocab": vec.get_feature_names_out().tolist(), "idf": [r(v) for v in vec.idf_],
               "coef": [r(v) for v in clf.coef_[0]], "intercept": r(clf.intercept_[0]),
               "threshold": r(metrics["text"]["threshold"])}
    payload["version"] = version_of(payload)
    return payload, vec, clf


def transaction_fixture_cases(rng: np.random.Generator, n: int = 50) -> list[dict]:
    """Synthetic-but-realistic candidate inputs spanning the feature space (not training rows)."""
    cases = []
    types = ["transfer", "payment", "cash_out"]
    for i in range(n):
        at = int(rng.integers(1_600_000_000, 1_700_000_000))
        k_b = int(rng.integers(0, 12)); k_p = int(rng.integers(0, 12))
        bene_hist = [(int(at - rng.integers(1, 90 * 86400)), float(rng.lognormal(6, 1.2))) for _ in range(k_b)]
        payer_hist = [(int(at - rng.integers(1, 90 * 86400)), float(rng.lognormal(6, 1.2))) for _ in range(k_p)]
        threshold = float(rng.choice([10_000.0, 25_000.0, 200_000.0]))
        amount = float(rng.choice([rng.lognormal(6, 1.5), 0.95 * threshold, round(rng.lognormal(6, 1.5) / 100) * 100 or 100.0]))
        inputs = dict(amount=round(amount, 2), at=at, hour=int(rng.integers(0, 24)), weekday=None if rng.random() < 0.3 else int(rng.integers(0, 7)),
                      type_=str(rng.choice(types)), bene_history=bene_hist, payer_history=payer_hist,
                      pair_seen_before=bool(rng.random() < 0.6 and k_b > 0),
                      bene_first_seen_at=(min(t for t, _ in bene_hist) if bene_hist and rng.random() < 0.8 else None), threshold=threshold)
        feats = candidate_features(**inputs)
        cases.append({"id": i, "inputs": inputs, "features": vector(feats)})
    return cases


def text_fixture_cases(rng: np.random.Generator, n: int = 50) -> list[str]:
    from train import load_text_corpora
    df = load_text_corpora().sample(n=n - 6, random_state=SEED)
    texts = [t[:4000] for t in df.text.tolist()]
    texts += ["", "   ", "a I x", "Ünïcödé café naïve", "URGENT: please wire the funds today, our bank account has changed. Reply only to this address.",
              "Hi team, attached is the Q3 invoice. Same remittance details as always. Thanks!"]
    return texts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-fixtures", action="store_true")
    a = ap.parse_args(argv)
    metrics = json.loads((ART / "metrics.json").read_text())
    rng = np.random.default_rng(SEED)

    tx = export_transaction(metrics)
    pipe = joblib.load(MODELS / f"{SHIPPED_TRANSACTION}_lr.joblib")
    tx_cases = transaction_fixture_cases(rng)
    X = np.array([c["features"] for c in tx_cases])
    p_sklearn = pipe.predict_proba(X)[:, 1]
    tx_fixture = []
    for c, ps in zip(tx_cases, p_sklearn):
        s = score_transaction_exported(tx, c["features"])
        assert abs(s["probability"] - ps) < 1e-4, (c["id"], s["probability"], ps)
        tx_fixture.append({"id": c["id"], "features": c["features"], "inputs": {**c["inputs"], "bene_history": c["inputs"]["bene_history"], "payer_history": c["inputs"]["payer_history"]},
                           "logit": s["logit"], "probability": float(s["probability"]), "contributions": s["contributions"]})

    txt, vec, clf = export_text(metrics)
    texts = text_fixture_cases(rng)
    p_sk = clf.predict_proba(vec.transform(texts))[:, 1]
    txt_fixture = []
    for t, ps in zip(texts, p_sk):
        pe = score_exported(txt, t)
        assert abs(pe - ps) < 1e-4, (t[:40], pe, ps)
        txt_fixture.append({"text": t, "probability": pe})

    for path, payload in ((ART / "transaction_lr.json", tx), (ART / "email_tfidf_lr.json", txt)):
        path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        print(f"wrote {path.relative_to(ML.parent)} ({path.stat().st_size / 1024:.1f} KB) version {payload['version']}")
    if not a.no_fixtures:
        WEIGHTS_DIR.mkdir(parents=True, exist_ok=True); FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        (WEIGHTS_DIR / "transaction_lr.json").write_text(json.dumps(tx, separators=(",", ":")) + "\n")
        (WEIGHTS_DIR / "email_tfidf_lr.json").write_text(json.dumps(txt, separators=(",", ":")) + "\n")
        (FIXTURES_DIR / "transaction.json").write_text(json.dumps({"version": tx["version"], "cases": tx_fixture}, indent=1) + "\n")
        (FIXTURES_DIR / "text.json").write_text(json.dumps({"version": txt["version"], "cases": txt_fixture}, indent=1) + "\n")
        print(f"wrote weights to {WEIGHTS_DIR.relative_to(ML.parent)} and {len(tx_fixture)}+{len(txt_fixture)} parity fixtures to {FIXTURES_DIR.relative_to(ML.parent)}")
    assert (ART / "email_tfidf_lr.json").stat().st_size < 150 * 1024
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
