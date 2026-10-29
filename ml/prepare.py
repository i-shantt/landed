#!/usr/bin/env python
"""Load each source, compute features, cache to data/interim/<source>.parquet (the slow step, done once)."""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_NAMES, build_features  # noqa: E402
from loaders import LOADERS, THRESHOLDS  # noqa: E402

INTERIM = Path(__file__).resolve().parent / "data" / "interim"


def prepare(source: str, force: bool = False) -> Path:
    INTERIM.mkdir(parents=True, exist_ok=True)
    out = INTERIM / f"{source}.parquet"
    if out.exists() and not force:
        print(f"== {source}: cached {out.relative_to(INTERIM.parents[1])}")
        return out
    t0 = time.time()
    frame = LOADERS[source]()
    print(f"== {source}: {len(frame):,} rows, {int(frame.label.sum()):,} positives loaded in {time.time() - t0:.0f}s")
    t1 = time.time()
    feats = build_features(frame, THRESHOLDS[source])
    print(f"   features in {time.time() - t1:.0f}s")
    full = pd.concat([frame.reset_index(drop=True), feats.reset_index(drop=True)], axis=1)
    full.to_parquet(out, index=False)
    for split in ("train", "val", "test"):
        s = full[full.split == split]
        print(f"   {split:5s} {len(s):>9,} rows  {int(s.label.sum()):>6,} pos  ({s.label.mean():.4%})")
    return out


def load_prepared(source: str) -> pd.DataFrame:
    return pd.read_parquet(INTERIM / f"{source}.parquet")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=",".join(LOADERS))
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    for s in a.only.split(","):
        prepare(s, a.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
