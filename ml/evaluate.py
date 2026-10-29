"""Metrics, threshold selection, calibration, plots. Pure functions over (y, p)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score, roc_curve

ML = Path(__file__).resolve().parent
ART = ML / "artifacts"
PLOTS = ART / "plots"


def precision_at_k(y: np.ndarray, p: np.ndarray, k: int) -> float:
    k = int(min(max(k, 1), len(p)))
    idx = np.argsort(-p, kind="stable")[:k]
    return float(y[idx].mean())


def recall_at_fpr(y: np.ndarray, p: np.ndarray, fpr_max: float) -> float:
    fpr, tpr, _ = roc_curve(y, p)
    ok = fpr <= fpr_max
    return float(tpr[ok].max()) if ok.any() else 0.0


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        out.append({"lo": float(lo), "hi": float(hi), "n": int(m.sum()), "mean_pred": float(p[m].mean()) if m.any() else None, "frac_pos": float(y[m].mean()) if m.any() else None})
    return out


def confusion(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    pred = p >= thr
    tp = int((pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum())
    fn = int((~pred & (y == 1)).sum()); tn = int((~pred & (y == 0)).sum())
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": tp / (tp + fp) if tp + fp else 0.0, "recall": tp / (tp + fn) if tp + fn else 0.0,
            "fpr": fp / (fp + tn) if fp + tn else 0.0, "review_rate": (tp + fp) / len(y)}


def evaluate_scores(y: np.ndarray, p: np.ndarray, threshold: float | None = None) -> dict:
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float)
    n_pos = int(y.sum())
    out = {
        "n": int(len(y)), "positives": n_pos, "prevalence": float(y.mean()),
        "roc_auc": float(roc_auc_score(y, p)) if 0 < n_pos < len(y) else None,
        "pr_auc": float(average_precision_score(y, p)) if n_pos else None,
        "precision_at_100": precision_at_k(y, p, 100),
        "precision_at_1000": precision_at_k(y, p, 1000),
        "precision_at_0_5pct": precision_at_k(y, p, int(round(0.005 * len(y)))),
        "recall_at_fpr_0_1pct": recall_at_fpr(y, p, 0.001),
        "recall_at_fpr_1pct": recall_at_fpr(y, p, 0.01),
        "recall_at_fpr_5pct": recall_at_fpr(y, p, 0.05),
        "brier": float(brier_score_loss(y, p)),
        "reliability": reliability(y, p),
    }
    if threshold is not None:
        out["at_threshold"] = {"threshold": threshold, **confusion(y, p, threshold)}
    return out


def choose_threshold(y: np.ndarray, p: np.ndarray, cost_ratio: float) -> float:
    """Threshold minimising expected cost  C_FN * FN + C_FP * FP  with C_FN / C_FP = cost_ratio, on a grid."""
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float)
    grid = np.unique(np.concatenate([np.linspace(0.01, 0.99, 99), np.quantile(p, np.linspace(0.5, 0.9999, 200))]))
    best_t, best_cost = 0.5, float("inf")
    for t in grid:
        pred = p >= t
        fn = int((~pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum())
        cost = cost_ratio * fn + fp
        if cost < best_cost:
            best_cost, best_t = cost, float(t)
    return round(best_t, 4)


def platt_fit(logits: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Platt scaling p = sigmoid(a * logit + b) fitted by (unweighted) logistic regression on the validation window."""
    from sklearn.linear_model import LogisticRegression

    lr = LogisticRegression(C=1e6, max_iter=5000).fit(np.asarray(logits).reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


# ------------------------------------------------------------------ plots (SVG, matplotlib)

def _plt():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"svg.hashsalt": "landed", "font.size": 10, "figure.dpi": 100})
    return plt


def plot_curves(curves: dict[str, tuple[np.ndarray, np.ndarray]], out: Path, title: str, xlabel: str, ylabel: str, diag: bool = False) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(5, 4))
    for label, (x, y) in curves.items():
        ax.plot(x, y, label=label, linewidth=1.5)
    if diag:
        ax.plot([0, 1], [0, 1], linestyle="--", color="#999", linewidth=1)
    ax.set_xlabel(xlabel); ax.set_ylabel(ylabel); ax.set_title(title); ax.legend(frameon=False)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1.02)
    fig.tight_layout(); out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", metadata={"Date": None}); plt.close(fig)


def plot_reliability(rel_by_model: dict[str, list[dict]], out: Path) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(5, 4))
    ax.plot([0, 1], [0, 1], linestyle="--", color="#999", linewidth=1)
    for label, rel in rel_by_model.items():
        xs = [r["mean_pred"] for r in rel if r["n"] > 0]; ys = [r["frac_pos"] for r in rel if r["n"] > 0]
        ax.plot(xs, ys, marker="o", markersize=3, label=label, linewidth=1.5)
    ax.set_xlabel("mean predicted probability"); ax.set_ylabel("observed fraud rate"); ax.set_title("Reliability (test)"); ax.legend(frameon=False)
    fig.tight_layout(); out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", metadata={"Date": None}); plt.close(fig)


def plot_hist(p_pos: np.ndarray, p_neg: np.ndarray, thr: float, out: Path, title: str) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(5, 3.5))
    bins = np.linspace(0, 1, 41)
    ax.hist(p_neg, bins=bins, density=True, alpha=0.6, label="legitimate")
    ax.hist(p_pos, bins=bins, density=True, alpha=0.6, label="fraud")
    ax.axvline(thr, color="k", linewidth=1, linestyle=":", label=f"threshold {thr:.2f}")
    ax.set_yscale("log"); ax.set_xlabel("model probability"); ax.set_ylabel("density (log)"); ax.set_title(title); ax.legend(frameon=False)
    fig.tight_layout(); out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", metadata={"Date": None}); plt.close(fig)


def plot_bars(labels: list[str], values: list[float], out: Path, title: str, ylabel: str) -> None:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.bar(labels, values, color="#4c72b0")
    for i, v in enumerate(values):
        ax.text(i, v + 0.01, f"{v:.2f}", ha="center", fontsize=8)
    ax.set_ylim(0, 1.1); ax.set_ylabel(ylabel); ax.set_title(title)
    plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
    fig.tight_layout(); out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, format="svg", metadata={"Date": None}); plt.close(fig)


def render_plots() -> None:
    """Re-score held-out windows with the saved models and draw the SVGs."""
    import joblib
    from sklearn.metrics import precision_recall_curve
    sys.path.insert(0, str(ML))
    from features import FEATURE_NAMES
    from prepare import load_prepared
    from train import MODELS, TRANSACTION_SOURCES, load_metrics

    metrics = load_metrics()
    rel = {}
    for name in TRANSACTION_SOURCES + ["combined"]:
        if name not in metrics["transaction"]:
            continue
        frames = [load_prepared(s) for s in (TRANSACTION_SOURCES if name == "combined" else [name])]
        te = __import__("pandas").concat(frames, ignore_index=True).query("split == 'test'")
        X = te[FEATURE_NAMES].to_numpy(dtype=float); y = te.label.to_numpy()
        curves_pr, curves_roc = {}, {}
        for kind in ("lr", "gbm"):
            path = MODELS / f"{name}_{kind}.joblib"
            if not path.exists():
                continue
            p = joblib.load(path).predict_proba(X)[:, 1]
            pr, rc, _ = precision_recall_curve(y, p); fpr, tpr, _ = roc_curve(y, p)
            lab = f"{kind.upper()} (PR-AUC {average_precision_score(y, p):.3f})"
            curves_pr[lab] = (rc, pr); curves_roc[f"{kind.upper()} (AUC {roc_auc_score(y, p):.3f})"] = (fpr, tpr)
            if kind == "lr":
                rel[name] = reliability(y, p)
                plot_hist(p[y == 1], p[y == 0], metrics["transaction"][name]["lr"]["threshold"], PLOTS / f"hist_{name}.svg", f"Score distribution, {name} test")
        plot_curves(curves_pr, PLOTS / f"pr_{name}.svg", f"Precision-recall, {name} test", "recall", "precision")
        plot_curves(curves_roc, PLOTS / f"roc_{name}.svg", f"ROC, {name} test", "false positive rate", "true positive rate", diag=True)
    if rel:
        plot_reliability(rel, PLOTS / "reliability.svg")
    ap_path = ART / "metrics.json"
    m = json.loads(ap_path.read_text())
    if "ap_scenarios" in m:
        sc = m["ap_scenarios"]["per_scenario"]
        plot_bars(list(sc), [sc[k]["recall"] for k in sc], PLOTS / "ap_scenarios.svg", "AP scenario recall at the shipped threshold (synthetic)", "recall")


if __name__ == "__main__":
    render_plots()
    print("plots written to", PLOTS)
