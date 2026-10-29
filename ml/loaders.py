"""Each public source -> one canonical transaction frame.

Columns: source, payer, beneficiary, amount (major units), at (seconds), type, hour, weekday (0=Sun..6, NaN
when unknown), label (0/1), split ("train" | "val" | "test"). Splits are by time, never random.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).resolve().parent / "data" / "raw"

# "just under the approval threshold" band per source; Landed uses policy.dualApprovalAboveCents at run time.
THRESHOLDS = {"paysim": 200_000.0, "sparkov": 10_000.0}

PAYSIM_TYPES = {"TRANSFER": "transfer", "CASH_OUT": "cash_out", "PAYMENT": "payment"}


def load_paysim(path: Path = RAW / "paysim" / "paysim.csv") -> pd.DataFrame:
    df = pd.read_csv(path, usecols=["step", "type", "amount", "nameOrig", "nameDest", "isFraud"], dtype={"nameOrig": "string", "nameDest": "string"})
    # fraud exists only in TRANSFER and CASH_OUT; the balance columns are label leakage and are never read
    df = df[df["type"].isin(["TRANSFER", "CASH_OUT"])].reset_index(drop=True)
    step = df["step"].to_numpy(dtype=np.int64)
    out = pd.DataFrame({
        "source": "paysim",
        "payer": df["nameOrig"].astype(str),
        "beneficiary": df["nameDest"].astype(str),
        "amount": df["amount"].astype(float),
        "at": step * 3600,
        "type": df["type"].map(PAYSIM_TYPES),
        "hour": step % 24,
        "weekday": np.nan,
        "label": df["isFraud"].astype(int),
    })
    out["split"] = np.where(step <= 500, "train", np.where(step <= 600, "val", "test"))
    return out


def _sparkov_frame(df: pd.DataFrame) -> pd.DataFrame:
    ts = pd.to_datetime(df["trans_date_trans_time"])
    return pd.DataFrame({
        "source": "sparkov",
        "payer": df["cc_num"].astype(str),
        "beneficiary": df["merchant"].astype(str),
        "amount": df["amt"].astype(float),
        "at": df["unix_time"].astype(np.int64),
        "type": "payment",
        "hour": ts.dt.hour.astype(int),
        "weekday": ((ts.dt.dayofweek + 1) % 7).astype(float),  # pandas Monday=0 -> ours Sunday=0
        "label": df["is_fraud"].astype(int),
        "_ts": ts,
    })


def load_sparkov(train_path: Path = RAW / "sparkov" / "credit_card_transaction_train.csv", test_path: Path = RAW / "sparkov" / "credit_card_transaction_test.csv") -> pd.DataFrame:
    cols = ["trans_date_trans_time", "cc_num", "merchant", "amt", "unix_time", "is_fraud"]
    tr = _sparkov_frame(pd.read_csv(train_path, usecols=cols))
    te = _sparkov_frame(pd.read_csv(test_path, usecols=cols))
    tr["split"] = np.where(tr["_ts"] < pd.Timestamp("2020-03-01"), "train", "val")
    te["split"] = "test"
    out = pd.concat([tr, te], ignore_index=True).drop(columns=["_ts"])
    return out.sort_values("at", kind="stable").reset_index(drop=True)


LOADERS = {"paysim": load_paysim, "sparkov": load_sparkov}
