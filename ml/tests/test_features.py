import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features import DAY, FEATURE_NAMES, HOUR, build_features, candidate_features, median, vector  # noqa: E402

T = 10_000.0


def frame():
    rows = [
        # payer, beneficiary, amount, at(s), type, hour, weekday
        ("A", "V1", 100.0, 0 * HOUR, "payment", 9, 1),
        ("A", "V1", 120.0, 2 * HOUR, "payment", 11, 1),
        ("A", "V1", 110.0, 5 * HOUR, "payment", 14, 1),
        ("A", "V1", 400.0, 30 * HOUR, "payment", 15, 2),     # 3 prior -> ratio vs median(100,110,120)=110
        ("B", "V1", 9_500.0, 30 * HOUR, "transfer", 15, 2),  # tie on timestamp with the row above; just under T
        ("B", "V2", 50.0, 8 * DAY, "cash_out", 3, 0),        # off hours, weekend, new beneficiary
        ("A", "V1", 200.0, 8 * DAY + HOUR, "payment", 4, 0),  # 7d window: only rows within 7d count
    ]
    return pd.DataFrame(rows, columns=["payer", "beneficiary", "amount", "at", "type", "hour", "weekday"])


def test_vectorised_matches_per_candidate():
    df = frame()
    vec = build_features(df, T)
    assert list(vec.columns) == FEATURE_NAMES
    for i, r in df.iterrows():
        earlier = df[df["at"] < r["at"]]
        bene_hist = [(int(t), float(a)) for t, a in earlier[earlier.beneficiary == r.beneficiary][["at", "amount"]].to_numpy()]
        payer_hist = [(int(t), float(a)) for t, a in earlier[earlier.payer == r.payer][["at", "amount"]].to_numpy()]
        pair_seen = bool(((earlier.payer == r.payer) & (earlier.beneficiary == r.beneficiary)).any())
        first = df[df.beneficiary == r.beneficiary]["at"].min()
        got = candidate_features(amount=float(r["amount"]), at=int(r["at"]), hour=int(r["hour"]), weekday=int(r["weekday"]), type_=r["type"],
                                 bene_history=bene_hist, payer_history=payer_hist, pair_seen_before=pair_seen,
                                 bene_first_seen_at=int(first), threshold=T)
        for name in FEATURE_NAMES:
            assert math.isclose(got[name], float(vec.loc[i, name]), rel_tol=0, abs_tol=1e-12), (i, name, got[name], vec.loc[i, name])


def test_specific_values():
    v = build_features(frame(), T)
    r3 = v.iloc[3]
    assert r3["is_new_beneficiary"] == 0 and r3["bene_count_24h"] == 0 and r3["bene_count_7d"] == 3
    assert math.isclose(r3["bene_amount_ratio_median"], 400 / 110) and r3["bene_amount_ratio_missing"] == 0
    assert math.isclose(r3["bene_age_days"], 30 / 24)
    r4 = v.iloc[4]
    assert r4["just_under_threshold"] == 1 and r4["is_new_beneficiary"] == 1 and r4["type_transfer"] == 1
    assert r4["bene_count_7d"] == 3 and r4["payer_count_24h"] == 0  # tie at same timestamp is not counted
    assert r4["payer_amount_ratio_missing"] == 1 and r4["payer_amount_ratio_median"] == 1.0
    r5 = v.iloc[5]
    assert r5["is_off_hours"] == 1 and r5["is_weekend"] == 1 and r5["is_weekend_missing"] == 0 and r5["is_new_beneficiary"] == 1
    assert r5["type_cash_out"] == 1 and r5["is_round_amount"] == 0
    r6 = v.iloc[6]
    assert r6["bene_count_7d"] == 2 and r6["bene_count_24h"] == 0  # rows at 30h and 30h are within 7d of 8d+1h; 0-5h are not
    assert r6["is_round_amount"] == 1
    assert v.iloc[0]["bene_amount_ratio_missing"] == 1 and v.iloc[0]["amount_log"] == math.log1p(100)


def test_weekday_missing_indicator():
    df = frame()
    df["weekday"] = np.nan
    v = build_features(df, T)
    assert (v["is_weekend_missing"] == 1).all() and (v["is_weekend"] == 0).all()
    got = candidate_features(amount=1, at=0, hour=12, weekday=None, type_="payment", bene_history=[], payer_history=[], pair_seen_before=False, bene_first_seen_at=None, threshold=T)
    assert got["is_weekend_missing"] == 1 and got["bene_age_days"] == 0 and len(vector(got)) == len(FEATURE_NAMES)


def test_median_matches_numpy():
    for xs in ([1.0], [1.0, 3.0], [5.0, 1.0, 3.0], [4.0, 1.0, 3.0, 2.0]):
        assert median(xs) == float(np.median(xs))
