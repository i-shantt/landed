#!/usr/bin/env python
"""Train the transaction models (per source and combined) and the email text model.

Writes artifacts/models/*.joblib and artifacts/metrics.json incrementally (restartable).
Logistic regression is the shipped model; HistGradientBoosting is the reported ceiling.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import choose_threshold, evaluate_scores, platt_fit  # noqa: E402
from features import FEATURE_NAMES  # noqa: E402
from prepare import load_prepared  # noqa: E402
from text import make_vectorizer  # noqa: E402

ML = Path(__file__).resolve().parent
ART = ML / "artifacts"
MODELS = ART / "models"
METRICS = ART / "metrics.json"
RAW = ML / "data" / "raw"
SEED = 1300
NEG_PER_POS = 20          # LR fit only: negatives downsampled 20:1 in the train window
COST_RATIO = 20.0         # C_FN / C_FP used to pick the operating threshold on validation
TRANSACTION_SOURCES = ["paysim", "sparkov"]


def load_metrics() -> dict:
    return json.loads(METRICS.read_text()) if METRICS.exists() else {"seed": SEED, "cost_ratio": COST_RATIO, "transaction": {}, "text": {}}


def save_metrics(m: dict) -> None:
    ART.mkdir(parents=True, exist_ok=True)
    METRICS.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")


def lr_pipeline(C: float) -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="constant", fill_value=0.0)),
        ("scale", StandardScaler()),
        ("lr", LogisticRegression(C=C, class_weight="balanced", max_iter=2000, random_state=SEED)),
    ])


def downsample(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    pos = df[df.label == 1]
    neg = df[df.label == 0]
    k = min(len(neg), NEG_PER_POS * max(len(pos), 1))
    return pd.concat([pos, neg.sample(n=k, random_state=int(rng.integers(0, 2**31 - 1)))]).sort_index()


def fit_transaction(name: str, frames: list[pd.DataFrame], metrics: dict, skip_gbm: bool = False) -> None:
    df = pd.concat(frames, ignore_index=True)
    tr, va, te = (df[df.split == s] for s in ("train", "val", "test"))
    X = lambda d: d[FEATURE_NAMES].to_numpy(dtype=float)  # noqa: E731
    rng = np.random.default_rng(SEED)
    tr_lr = downsample(tr, rng)
    print(f"== {name}: train {len(tr):,} (LR fit on {len(tr_lr):,}), val {len(va):,}, test {len(te):,}")
    entry = metrics["transaction"].setdefault(name, {})
    entry["rows"] = {"train": int(len(tr)), "train_lr_fit": int(len(tr_lr)), "val": int(len(va)), "test": int(len(te)),
                     "positives": {"train": int(tr.label.sum()), "val": int(va.label.sum()), "test": int(te.label.sum())}}

    # --- logistic regression: pick C on validation PR-AUC
    best = None
    for C in (0.01, 0.1, 1.0):
        t0 = time.time()
        pipe = lr_pipeline(C).fit(X(tr_lr), tr_lr.label)
        p_va = pipe.predict_proba(X(va))[:, 1]
        m_va = evaluate_scores(va.label.to_numpy(), p_va)
        print(f"   LR C={C}: val PR-AUC {m_va['pr_auc']:.4f} ROC {m_va['roc_auc']:.4f} ({time.time() - t0:.0f}s)")
        if best is None or m_va["pr_auc"] > best[1]:
            best = (C, m_va["pr_auc"], pipe)
    C, _, lr = best
    p_va = lr.predict_proba(X(va))[:, 1]
    a, b = platt_fit(lr.decision_function(X(va)), va.label.to_numpy())
    thr = choose_threshold(va.label.to_numpy(), p_va, COST_RATIO)
    p_te = lr.predict_proba(X(te))[:, 1]
    entry["lr"] = {
        "C": C,
        "val": evaluate_scores(va.label.to_numpy(), p_va, threshold=thr),
        "test": evaluate_scores(te.label.to_numpy(), p_te, threshold=thr),
        "threshold": thr,
        "platt": {"a": a, "b": b},
    }
    MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump(lr, MODELS / f"{name}_lr.joblib")
    save_metrics(metrics)
    print(f"   LR test: PR-AUC {entry['lr']['test']['pr_auc']:.4f} ROC {entry['lr']['test']['roc_auc']:.4f} thr {thr:.3f}")

    if skip_gbm:
        return
    t0 = time.time()
    gbm = HistGradientBoostingClassifier(max_iter=200, max_depth=4, learning_rate=0.05, class_weight="balanced", random_state=SEED)
    gbm.fit(X(tr), tr.label)
    p_va = gbm.predict_proba(X(va))[:, 1]
    thr_g = choose_threshold(va.label.to_numpy(), p_va, COST_RATIO)
    entry["gbm"] = {
        "val": evaluate_scores(va.label.to_numpy(), p_va, threshold=thr_g),
        "test": evaluate_scores(te.label.to_numpy(), gbm.predict_proba(X(te))[:, 1], threshold=thr_g),
        "threshold": thr_g,
    }
    joblib.dump(gbm, MODELS / f"{name}_gbm.joblib")
    save_metrics(metrics)
    print(f"   GBM test: PR-AUC {entry['gbm']['test']['pr_auc']:.4f} ROC {entry['gbm']['test']['roc_auc']:.4f} ({time.time() - t0:.0f}s)")


def load_text_corpora() -> pd.DataFrame:
    ph = pd.read_csv(RAW / "phishing" / "Phishing_Email.csv")
    ph = pd.DataFrame({"corpus": "phishing", "text": ph["Email Text"].astype(str), "label": (ph["Email Type"] == "Phishing Email").astype(int)})
    ph = ph[ph.text.str.strip().str.len() > 0]
    parts = []
    for split in ("train", "dev", "test"):
        d = pd.read_json(RAW / "clair" / f"{split}.json", lines=True)
        parts.append(pd.DataFrame({"corpus": "clair", "text": d["text"].astype(str), "label": (d["label"] == "FRAUD").astype(int)}))
    return pd.concat([ph, *parts], ignore_index=True)


def fit_text(metrics: dict) -> None:
    df = load_text_corpora()
    df = df.drop_duplicates("text").reset_index(drop=True)
    strat = df["corpus"] + df["label"].astype(str)
    tr, rest = train_test_split(df, test_size=0.2, random_state=SEED, stratify=strat)
    va, te = train_test_split(rest, test_size=0.5, random_state=SEED, stratify=rest["corpus"] + rest["label"].astype(str))
    print(f"== text: train {len(tr):,}, val {len(va):,}, test {len(te):,}; positives {int(df.label.sum()):,}/{len(df):,}")
    vec = make_vectorizer()
    Xtr = vec.fit_transform(tr.text)
    best = None
    for C in (0.3, 1.0, 3.0):
        clf = LogisticRegression(C=C, class_weight="balanced", max_iter=3000, random_state=SEED).fit(Xtr, tr.label)
        p = clf.predict_proba(vec.transform(va.text))[:, 1]
        m = evaluate_scores(va.label.to_numpy(), p)
        print(f"   C={C}: val PR-AUC {m['pr_auc']:.4f} ROC {m['roc_auc']:.4f}")
        if best is None or m["pr_auc"] > best[1]:
            best = (C, m["pr_auc"], clf)
    C, _, clf = best
    p_va = clf.predict_proba(vec.transform(va.text))[:, 1]
    thr = choose_threshold(va.label.to_numpy(), p_va, 5.0)  # emails: C_FN/C_FP = 5 (false alarms are cheap, an analyst reads a message)
    out = {"C": C, "threshold": thr, "vocab_size": int(len(vec.get_feature_names_out())),
           "rows": {"train": int(len(tr)), "val": int(len(va)), "test": int(len(te))},
           "val": evaluate_scores(va.label.to_numpy(), p_va, threshold=thr),
           "test": evaluate_scores(te.label.to_numpy(), clf.predict_proba(vec.transform(te.text))[:, 1], threshold=thr)}
    for corpus in ("phishing", "clair"):
        sub = te[te.corpus == corpus]
        out[f"test_{corpus}"] = evaluate_scores(sub.label.to_numpy(), clf.predict_proba(vec.transform(sub.text))[:, 1], threshold=thr)
    metrics["text"] = out
    MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump({"vectorizer": vec, "clf": clf}, MODELS / "email_tfidf_lr.joblib")
    save_metrics(metrics)
    print(f"   text test: PR-AUC {out['test']['pr_auc']:.4f} ROC {out['test']['roc_auc']:.4f} vocab {out['vocab_size']}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="paysim,sparkov,combined,text")
    ap.add_argument("--skip-gbm", action="store_true")
    a = ap.parse_args(argv)
    todo = a.only.split(",")
    metrics = load_metrics()
    frames = {}
    for s in TRANSACTION_SOURCES:
        if s in todo or "combined" in todo:
            frames[s] = load_prepared(s)
    for s in TRANSACTION_SOURCES:
        if s in todo:
            fit_transaction(s, [frames[s]], metrics, a.skip_gbm)
    if "combined" in todo:
        fit_transaction("combined", [frames[s] for s in TRANSACTION_SOURCES], metrics, a.skip_gbm)
    if "text" in todo:
        fit_text(metrics)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
