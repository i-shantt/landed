import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trees import LEAF, export_trees, score_trees_exported  # noqa: E402


def bundle():
    # Two hand-built stumps over features [a, b]. Node = [feature, threshold, left, right, missing_left, value]; leaf = [-1, value].
    t1 = [[0, 1.5, 1, 2, 1, 0.1], [LEAF, -0.4], [LEAF, 0.9]]            # a <= 1.5 -> -0.4 else 0.9 ; NaN goes left
    t2 = [[1, 0.0, 1, 4, 0, 0.0], [0, 10.0, 2, 3, 0, -0.2], [LEAF, -0.3], [LEAF, 0.5], [LEAF, 0.7]]  # b <= 0 -> (a <= 10 -> -0.3 else 0.5) else 0.7 ; NaN goes right
    return {"features": ["a", "b"], "baseline": 0.25, "trees": [t1, t2]}


def test_routing_and_logit():
    w = bundle()
    s = score_trees_exported(w, [1.0, -1.0])      # t1 left (-0.4), t2: b<=0 -> a<=10 -> -0.3
    assert math.isclose(s["logit"], 0.25 - 0.4 - 0.3)
    assert math.isclose(s["probability"], 1 / (1 + math.exp(-s["logit"])))
    s = score_trees_exported(w, [12.0, 1.0])      # t1 right (0.9), t2: b>0 -> 0.7
    assert math.isclose(s["logit"], 0.25 + 0.9 + 0.7)
    s = score_trees_exported(w, [1.5, 0.0])       # x == threshold goes left in both
    assert math.isclose(s["logit"], 0.25 - 0.4 - 0.3)


def test_missing_values_follow_the_exported_side():
    w = bundle()
    s = score_trees_exported(w, [float("nan"), float("nan")])
    assert math.isclose(s["logit"], 0.25 - 0.4 + 0.7)   # t1 NaN -> left, t2 NaN -> right


def test_path_contributions_sum_to_logit_minus_bias():
    w = bundle()
    for x in ([1.0, -1.0], [12.0, 1.0], [12.0, -1.0], [0.0, 0.0]):
        s = score_trees_exported(w, x)
        assert math.isclose(sum(s["contributions"]), s["logit"] - s["bias"], abs_tol=1e-12)
    s = score_trees_exported(w, [12.0, -1.0])     # t1: root 0.1 -> leaf 0.9 (a: +0.8); t2: root 0 -> -0.2 (b) -> 0.5 (a: +0.7)
    assert math.isclose(s["contributions"][0], 0.8 + 0.7)
    assert math.isclose(s["contributions"][1], -0.2)
    assert math.isclose(s["bias"], 0.25 + 0.1 + 0.0)


def test_export_matches_sklearn_decision_function():
    from sklearn.ensemble import HistGradientBoostingClassifier

    rng = np.random.default_rng(7)
    X = rng.normal(size=(3000, 4))
    y = ((X[:, 0] + 0.5 * X[:, 1] * X[:, 2] + rng.normal(scale=0.3, size=3000)) > 0.2).astype(int)
    X[rng.random(3000) < 0.05, 3] = np.nan
    gbm = HistGradientBoostingClassifier(max_iter=25, max_depth=3, learning_rate=0.1, random_state=1).fit(X, y)
    w = {"features": ["x0", "x1", "x2", "x3"], **export_trees(gbm)}
    assert w["n_trees"] == 25 and w["max_depth"] <= 3
    Xt = rng.normal(size=(500, 4)); Xt[rng.random(500) < 0.1, 3] = np.nan
    z = gbm.decision_function(Xt)
    for k in range(500):
        s = score_trees_exported(w, [float(v) for v in Xt[k]])
        assert abs(s["logit"] - z[k]) < 2e-6, k
        assert abs(sum(s["contributions"]) - (s["logit"] - s["bias"])) < 1e-9
