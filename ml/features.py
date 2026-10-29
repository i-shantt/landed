"""Feature contract for the transaction model.

This file is the source of truth for what a feature means. `web/convex/risk/model/features.ts`
computes the SAME features from Landed's own payments, and `web/tests/modelParity.test.ts` asserts
that the TypeScript scorer reproduces Python's probabilities on fixtures written by export.py.

Two implementations live here on purpose:
  * `build_features(frame, threshold)`   vectorised over a whole canonical frame (training);
  * `candidate_features(...)`             one candidate against explicit history lists (what the
                                          TypeScript side does for a live payment).
`test_features.py` checks they agree.

Canonical frame columns (see loaders.py): payer, beneficiary, amount (major units, float), at (seconds),
type ("transfer" | "payment" | "cash_out"), hour (0-23), weekday (0=Sunday..6, or NaN when the source
has no calendar), label (0/1).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

HOUR = 3600
DAY = 24 * HOUR

FEATURE_NAMES: list[str] = [
    "amount_log",
    "hour_sin",
    "hour_cos",
    "is_off_hours",
    "is_weekend",
    "is_weekend_missing",
    "type_transfer",
    "type_payment",
    "type_cash_out",
    "is_new_beneficiary",
    "bene_count_24h",
    "bene_count_7d",
    "payer_count_24h",
    "bene_amount_ratio_median",
    "bene_amount_ratio_missing",
    "payer_amount_ratio_median",
    "payer_amount_ratio_missing",
    "bene_age_days",
    "is_round_amount",
    "just_under_threshold",
]

MIN_HISTORY_FOR_MEDIAN = 3
UNDER_THRESHOLD_BAND = 0.9


def _window_counts(group_codes: np.ndarray, at: np.ndarray, window_s: int) -> np.ndarray:
    """Number of earlier rows in the same group with time in [at - window, at). Vectorised.

    Rows are keyed by (group, time); a row with the SAME timestamp as the candidate is not counted,
    which matches "payments sent strictly before this one" on the TypeScript side.
    """
    span = int(at.max() - at.min()) + window_s + 2
    base = at.min() - 1
    key = group_codes.astype(np.int64) * span + (at - base).astype(np.int64)
    order = np.argsort(key, kind="stable")
    sorted_key = key[order]
    lo = np.searchsorted(sorted_key, key - window_s, side="left")
    hi = np.searchsorted(sorted_key, key, side="left")  # strictly earlier
    out = np.empty_like(hi)
    out[:] = hi - lo
    return out


def _prior_median(frame: pd.DataFrame, by: str) -> tuple[np.ndarray, np.ndarray]:
    """Median of amounts of EARLIER rows in the same group (ties on time excluded), and their count."""
    df = frame[[by, "at", "amount"]].copy()
    df["_i"] = np.arange(len(df))
    df = df.sort_values([by, "at", "_i"], kind="stable")
    g = df.groupby(by, sort=False)
    # expanding median including the current row, then shift to exclude it
    med_incl = g["amount"].expanding().median().to_numpy()
    cnt_incl = g.cumcount().to_numpy() + 1
    med_prev = np.roll(med_incl, 1)
    cnt_prev = cnt_incl - 1
    first_in_group = cnt_prev == 0
    med_prev[first_in_group] = np.nan
    # exclude rows with identical timestamps: treat them as "not yet seen"
    # (rare in Sparkov, common in PaySim where a step is an hour); recompute for tied rows
    same_t = (df["at"].to_numpy() == np.roll(df["at"].to_numpy(), 1)) & (df[by].to_numpy() == np.roll(df[by].to_numpy(), 1))
    if same_t.any():
        # walk back to the first row of the tie block
        tie_start = np.arange(len(df))
        for i in np.flatnonzero(same_t):
            tie_start[i] = tie_start[i - 1]
        med_prev = med_prev[tie_start]
        cnt_prev = cnt_prev[tie_start]
    out_med = np.empty(len(frame))
    out_cnt = np.empty(len(frame), dtype=np.int64)
    idx = df["_i"].to_numpy()
    out_med[idx] = med_prev
    out_cnt[idx] = cnt_prev
    return out_med, out_cnt


def build_features(frame: pd.DataFrame, threshold: float) -> pd.DataFrame:
    """Vectorised features for a canonical frame. Row order is preserved."""
    f = pd.DataFrame(index=frame.index)
    amount = frame["amount"].to_numpy(dtype=float)
    at = frame["at"].to_numpy(dtype=np.int64)
    hour = frame["hour"].to_numpy(dtype=float)
    weekday = frame["weekday"].to_numpy(dtype=float)

    f["amount_log"] = np.log1p(np.maximum(amount, 0.0))
    f["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    f["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    f["is_off_hours"] = ((hour < 6) | (hour >= 20)).astype(float)
    wk_missing = np.isnan(weekday)
    f["is_weekend"] = np.where(wk_missing, 0.0, ((weekday == 0) | (weekday == 6)).astype(float))
    f["is_weekend_missing"] = wk_missing.astype(float)
    t = frame["type"].astype(str).to_numpy()
    f["type_transfer"] = (t == "transfer").astype(float)
    f["type_payment"] = (t == "payment").astype(float)
    f["type_cash_out"] = (t == "cash_out").astype(float)

    order = np.lexsort((np.arange(len(frame)), at))  # time, then original order
    pair = frame["payer"].astype(str) + "\x1f" + frame["beneficiary"].astype(str)
    seen = pd.Series(pair.to_numpy()[order]).duplicated(keep="first").to_numpy()
    is_new = np.empty(len(frame), dtype=bool)
    is_new[order] = ~seen
    # a pair repeated at the same timestamp still counts as new for all tied rows (strictly-before rule)
    f["is_new_beneficiary"] = is_new.astype(float)
    _fix_ties_new_beneficiary(f, frame, pair, at)

    bene_codes = pd.factorize(frame["beneficiary"])[0]
    payer_codes = pd.factorize(frame["payer"])[0]
    f["bene_count_24h"] = _window_counts(bene_codes, at, DAY).astype(float)
    f["bene_count_7d"] = _window_counts(bene_codes, at, 7 * DAY).astype(float)
    f["payer_count_24h"] = _window_counts(payer_codes, at, DAY).astype(float)

    bmed, bcnt = _prior_median(frame, "beneficiary")
    pmed, pcnt = _prior_median(frame, "payer")
    f["bene_amount_ratio_median"], f["bene_amount_ratio_missing"] = _ratio(amount, bmed, bcnt)
    f["payer_amount_ratio_median"], f["payer_amount_ratio_missing"] = _ratio(amount, pmed, pcnt)

    first_seen = frame.groupby("beneficiary")["at"].transform("min").to_numpy(dtype=np.int64)
    f["bene_age_days"] = (at - first_seen) / DAY
    f["is_round_amount"] = ((amount > 0) & (np.mod(amount, 100.0) == 0)).astype(float)
    f["just_under_threshold"] = ((amount >= UNDER_THRESHOLD_BAND * threshold) & (amount < threshold)).astype(float)
    return f[FEATURE_NAMES]


def _fix_ties_new_beneficiary(f: pd.DataFrame, frame: pd.DataFrame, pair: pd.Series, at: np.ndarray) -> None:
    """Rows of the same pair at the same timestamp: none has seen the other, so all are new."""
    df = pd.DataFrame({"pair": pair.to_numpy(), "at": at})
    first_at = df.groupby("pair")["at"].transform("min").to_numpy()
    f.loc[(at == first_at), "is_new_beneficiary"] = 1.0


def _ratio(amount: np.ndarray, med: np.ndarray, cnt: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    ok = (cnt >= MIN_HISTORY_FOR_MEDIAN) & np.isfinite(med) & (med > 0)
    ratio = np.where(ok, amount / np.where(ok, med, 1.0), 1.0)
    return ratio, (~ok).astype(float)


# --------------------------------------------------------------------------------------------
# Per-candidate implementation (mirrors web/convex/risk/model/features.ts)
# --------------------------------------------------------------------------------------------

def candidate_features(
    *,
    amount: float,
    at: int,
    hour: int,
    weekday: int | None,
    type_: str,
    bene_history: list[tuple[int, float]],   # (at_seconds, amount) of earlier payments to this beneficiary
    payer_history: list[tuple[int, float]],  # (at_seconds, amount) of earlier payments by this payer
    pair_seen_before: bool,
    bene_first_seen_at: int | None,          # None when the beneficiary has never been paid
    threshold: float,
) -> dict[str, float]:
    bene_prior = [(t, a) for t, a in bene_history if t < at]
    payer_prior = [(t, a) for t, a in payer_history if t < at]
    out: dict[str, float] = {}
    out["amount_log"] = math.log1p(max(amount, 0.0))
    out["hour_sin"] = math.sin(2 * math.pi * hour / 24.0)
    out["hour_cos"] = math.cos(2 * math.pi * hour / 24.0)
    out["is_off_hours"] = 1.0 if (hour < 6 or hour >= 20) else 0.0
    out["is_weekend"] = 0.0 if weekday is None else (1.0 if weekday in (0, 6) else 0.0)
    out["is_weekend_missing"] = 1.0 if weekday is None else 0.0
    out["type_transfer"] = 1.0 if type_ == "transfer" else 0.0
    out["type_payment"] = 1.0 if type_ == "payment" else 0.0
    out["type_cash_out"] = 1.0 if type_ == "cash_out" else 0.0
    out["is_new_beneficiary"] = 0.0 if pair_seen_before else 1.0
    out["bene_count_24h"] = float(sum(1 for t, _ in bene_prior if t >= at - DAY))
    out["bene_count_7d"] = float(sum(1 for t, _ in bene_prior if t >= at - 7 * DAY))
    out["payer_count_24h"] = float(sum(1 for t, _ in payer_prior if t >= at - DAY))
    out["bene_amount_ratio_median"], out["bene_amount_ratio_missing"] = _ratio_one(amount, [a for _, a in bene_prior])
    out["payer_amount_ratio_median"], out["payer_amount_ratio_missing"] = _ratio_one(amount, [a for _, a in payer_prior])
    first = bene_first_seen_at if bene_first_seen_at is not None else at
    out["bene_age_days"] = max(0.0, (at - min(first, at)) / DAY)
    out["is_round_amount"] = 1.0 if (amount > 0 and math.fmod(amount, 100.0) == 0.0) else 0.0
    out["just_under_threshold"] = 1.0 if (UNDER_THRESHOLD_BAND * threshold <= amount < threshold) else 0.0
    return out


def median(xs: list[float]) -> float:
    """Lower-middle-free median identical to numpy's for the sizes we use (average of two middles)."""
    s = sorted(xs)
    n = len(s)
    if n == 0:
        return float("nan")
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def _ratio_one(amount: float, prior: list[float]) -> tuple[float, float]:
    if len(prior) < MIN_HISTORY_FOR_MEDIAN:
        return 1.0, 1.0
    m = median(prior)
    if not (m > 0):
        return 1.0, 1.0
    return amount / m, 0.0


def vector(features: dict[str, float]) -> list[float]:
    return [float(features[n]) for n in FEATURE_NAMES]
