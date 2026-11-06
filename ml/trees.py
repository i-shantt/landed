"""Gradient-boosted trees as data: export sklearn's HistGradientBoostingClassifier to a compact JSON
bundle and score it with a dependency-free walker that TypeScript mirrors (web/convex/risk/model/trees.ts).

Bundle shape (arrays, not maps; the TS side indexes them directly):

  {"family": "transaction_gbm", "features": [...20 names...], "baseline": b, "n_trees": T, "max_depth": d,
   "trees": [ [node, node, ...], ... ],  # one array per tree, node 0 is the root
   "threshold": t, "calibration": {"method": "platt", "a": a, "b": b}, "version": "transaction_gbm-<sha8>"}

  internal node: [feature_idx, num_threshold, left, right, missing_go_to_left, value]
  leaf:          [-1, value]

Score: logit = baseline + sum(leaf value per tree); p = sigmoid(logit). Routing is `x <= threshold -> left`
with sklearn's missing-value side for NaN. Thresholds keep full double precision (a rounded threshold could
flip a comparison for a value that sits on it); values are rounded to 7 decimals (200 trees x 5e-8 < 1e-5).

Attribution: path contributions (Saabas 2014). Every split moves the estimate from the parent node's
value to the child's; that delta is credited to the split feature. Summed over trees the contributions add
up to logit - bias exactly, where bias = baseline + sum(root values). No model-agnostic approximation.
"""
from __future__ import annotations

import math

VALUE_ROUND = 7
LEAF = -1


def export_trees(gbm) -> dict:
    """Compact node arrays from a fitted sklearn HistGradientBoostingClassifier (binary)."""
    predictors = gbm._predictors
    if any(len(stage) != 1 for stage in predictors):
        raise ValueError("binary classifier expected (one tree per iteration)")
    trees = []
    max_depth = 0
    for (p,) in predictors:
        nodes = []
        for row in p.nodes:
            max_depth = max(max_depth, int(row["depth"]))
            if row["is_leaf"]:
                nodes.append([LEAF, round(float(row["value"]), VALUE_ROUND)])
            else:
                if row["is_categorical"]:
                    raise ValueError("categorical splits are not exported")
                nodes.append([int(row["feature_idx"]), float(row["num_threshold"]), int(row["left"]), int(row["right"]),
                              int(row["missing_go_to_left"]), round(float(row["value"]), VALUE_ROUND)])
        trees.append(nodes)
    baseline = float(gbm._baseline_prediction.reshape(-1)[0])
    return {"baseline": round(baseline, VALUE_ROUND), "n_trees": len(trees), "max_depth": max_depth, "trees": trees}


def node_value(node: list) -> float:
    return node[1] if node[0] == LEAF else node[5]


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def score_trees_exported(w: dict, x: list[float]) -> dict:
    """Mirror of scoreTrees in web/convex/risk/model/trees.ts. Returns logit, probability, bias and per-feature contributions."""
    n = len(w["features"]) if "features" in w else len(x)
    if len(x) != n:
        raise ValueError(f"feature vector has {len(x)} entries, bundle expects {n}")
    contributions = [0.0] * n
    logit = float(w["baseline"])
    bias = float(w["baseline"])
    for nodes in w["trees"]:
        i = 0
        prev = node_value(nodes[0])
        bias += prev
        while nodes[i][0] != LEAF:
            f, t, left, right, missing_left, _v = nodes[i]
            xi = x[f]
            if xi != xi:  # NaN
                i = left if missing_left else right
            else:
                i = left if xi <= t else right
            nv = node_value(nodes[i])
            contributions[f] += nv - prev
            prev = nv
        logit += nodes[i][1]
    return {"logit": logit, "probability": sigmoid(logit), "bias": bias, "contributions": contributions}
