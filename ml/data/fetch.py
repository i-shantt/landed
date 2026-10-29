#!/usr/bin/env python
"""Download the public datasets in sources.py into ml/data/raw/<key>/ and write ml/data/MANIFEST.json.

Idempotent and resumable:
  * hf_hub_download resumes partial `.incomplete` files on its own;
  * a file whose sha256 already matches the manifest is skipped unless --force;
  * the Kaggle fallback (kagglehub, no credentials needed for public datasets) is used only
    when the Hugging Face download fails.

Raw files are untrusted data: they are only ever read by pandas, never imported. Run this with
`python -I` so the current directory is not on sys.path.

Usage: python -I ml/data/fetch.py [--only paysim,sparkov] [--skip-optional] [--verify-only] [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sources import SOURCES, Source, ordered  # noqa: E402

ML = Path(__file__).resolve().parents[1]
RAW = ML / "data" / "raw"
MANIFEST = ML / "data" / "MANIFEST.json"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path = MANIFEST) -> dict:
    if not path.exists():
        return {"generated_by": "ml/data/fetch.py", "sources": {}}
    return json.loads(path.read_text())


def write_manifest(m: dict, path: Path = MANIFEST) -> None:
    m["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")


def _already_ok(source: Source, manifest: dict, raw_dir: Path) -> bool:
    entry = manifest["sources"].get(source.key)
    if not entry:
        return False
    known = {f["name"]: f["sha256"] for f in entry.get("files", [])}
    for name in source.files:
        p = raw_dir / source.key / name
        if not p.exists() or name not in known or sha256_file(p) != known[name]:
            return False
    return True


def fetch_hf(source: Source, raw_dir: Path) -> list[Path]:
    from huggingface_hub import hf_hub_download

    dest = raw_dir / source.key
    dest.mkdir(parents=True, exist_ok=True)
    out = []
    for name in source.files:
        p = hf_hub_download(repo_id=source.repo, filename=name, repo_type="dataset", local_dir=str(dest))
        out.append(Path(p))
    return out


def fetch_kaggle(source: Source, raw_dir: Path) -> list[Path]:
    import kagglehub

    dest = raw_dir / source.key
    dest.mkdir(parents=True, exist_ok=True)
    cache = Path(kagglehub.dataset_download(source.repo))
    out = []
    for name in source.files:
        found = next(cache.rglob(name), None)
        if found is None:
            raise FileNotFoundError(f"{name} not in kaggle download {cache}")
        target = dest / name
        if not target.exists():
            shutil.copy2(found, target)
        out.append(target)
    return out


def fetch(source: Source, raw_dir: Path = RAW, retries: int = 3) -> tuple[Source, list[Path]]:
    """Returns (source actually used, paths). Falls back to source.fallback after `retries` failures."""
    last: Exception | None = None
    for attempt in range(retries):
        try:
            if source.kind == "hf_file":
                return source, fetch_hf(source, raw_dir)
            if source.kind == "kaggle":
                return source, fetch_kaggle(source, raw_dir)
            raise ValueError(f"unknown kind {source.kind}")
        except Exception as e:  # noqa: BLE001 - network errors of many kinds
            last = e
            print(f"  attempt {attempt + 1}/{retries} failed for {source.repo}: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    if source.fallback is not None:
        print(f"  falling back to {source.fallback.kind}:{source.fallback.repo}", file=sys.stderr)
        return fetch(source.fallback, raw_dir, retries)
    raise RuntimeError(f"could not fetch {source.key}") from last


def _read_label_column(p: Path, label_col: str):
    import pandas as pd

    if p.suffix == ".csv":
        total, pos_counter = 0, {}
        for chunk in pd.read_csv(p, usecols=[label_col], chunksize=500_000, low_memory=False):
            total += len(chunk)
            vc = chunk[label_col].value_counts(dropna=False)
            for k, n in vc.items():
                pos_counter[k] = pos_counter.get(k, 0) + int(n)
        return total, pos_counter
    if p.suffix in (".json", ".jsonl"):
        with p.open("rb") as fh:
            head = fh.read(64).lstrip()
        df = pd.read_json(p) if head.startswith(b"[") else pd.read_json(p, lines=True)
        vc = df[label_col].value_counts(dropna=False)
        return len(df), {k: int(n) for k, n in vc.items()}
    raise ValueError(f"unsupported file type {p.suffix}")


def profile(source: Source, paths: list[Path]) -> dict:
    files = []
    rows = 0
    positives = 0
    for p in paths:
        files.append({"name": p.name, "bytes": p.stat().st_size, "sha256": sha256_file(p)})
        if source.label_col:
            n, counts = _read_label_column(p, source.label_col)
            rows += n
            positives += sum(c for k, c in counts.items() if _eq(k, source.label_pos))
    entry = {
        "key": source.key,
        "kind": source.kind,
        "repo": source.repo,
        "upstream": source.upstream,
        "license": source.license,
        "citation": source.citation,
        "domain": source.domain,
        "optional": source.optional,
        "files": files,
        "rows": rows,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if source.label_col:
        entry["label"] = {
            "col": source.label_col,
            "positive": source.label_pos,
            "positives": positives,
            "prevalence": (positives / rows) if rows else None,
        }
    return entry


def _eq(a, b) -> bool:
    try:
        return a == b or (isinstance(b, (int, float)) and float(a) == float(b))
    except (TypeError, ValueError):
        return False


def verify(manifest: dict, raw_dir: Path = RAW) -> list[str]:
    problems = []
    for key, entry in manifest["sources"].items():
        for f in entry["files"]:
            p = raw_dir / key / f["name"]
            if not p.exists():
                problems.append(f"{key}/{f['name']}: missing")
            elif sha256_file(p) != f["sha256"]:
                problems.append(f"{key}/{f['name']}: sha256 mismatch")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma-separated source keys")
    ap.add_argument("--skip-optional", action="store_true")
    ap.add_argument("--verify-only", action="store_true", help="recompute sha256 against MANIFEST.json and exit")
    ap.add_argument("--force", action="store_true", help="re-download even when the manifest sha matches")
    ap.add_argument("--raw-dir", default=str(RAW))
    ap.add_argument("--manifest", default=str(MANIFEST))
    a = ap.parse_args(argv)
    raw_dir = Path(a.raw_dir)
    manifest_path = Path(a.manifest)
    manifest = load_manifest(manifest_path)

    if a.verify_only:
        problems = verify(manifest, raw_dir)
        for p in problems:
            print("FAIL", p)
        print("verify:", "ok" if not problems else f"{len(problems)} problem(s)")
        return 1 if problems else 0

    keys = a.only.split(",") if a.only else None
    failed = []
    for source in ordered(keys, a.skip_optional):
        print(f"== {source.key} ({source.kind}:{source.repo})")
        if not a.force and _already_ok(source, manifest, raw_dir):
            print("  up to date (sha256 matches manifest)")
            continue
        try:
            used, paths = fetch(source, raw_dir)
        except Exception as e:  # noqa: BLE001
            print(f"  FAILED: {e}", file=sys.stderr)
            failed.append(source.key)
            continue
        entry = profile(used, paths)
        entry["key"] = source.key
        if used is not source:
            entry["via_fallback"] = f"{used.kind}:{used.repo}"
        manifest["sources"][source.key] = entry
        write_manifest(manifest, manifest_path)
        lab = entry.get("label")
        print(f"  {entry['rows']:,} rows" + (f", {lab['positives']:,} positives ({lab['prevalence']:.4%})" if lab else ""))
    if failed:
        print("failed:", ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    raise SystemExit(main())
