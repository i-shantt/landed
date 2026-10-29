import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "data"))
import fetch  # noqa: E402
from sources import SOURCES, Source, ordered  # noqa: E402


def test_registry_is_complete_and_commercially_usable():
    assert set(SOURCES) == {"paysim", "sparkov", "ibm_aml", "phishing", "clair"}
    for s in SOURCES.values():
        assert s.files and s.license and s.citation and s.label_col
        assert "NC" not in s.license.upper().replace("LICENSE", ""), s.key
    assert SOURCES["paysim"].fallback is not None and SOURCES["paysim"].fallback.kind == "kaggle"
    assert [s.key for s in ordered(skip_optional=True)] == ["paysim", "sparkov", "phishing", "clair"]
    assert [s.key for s in ordered(["clair"])] == ["clair"]


def test_profile_counts_rows_and_prevalence(tmp_path: Path):
    p = tmp_path / "toy.csv"
    rows = ["amount,isFraud"] + [f"{i},{1 if i % 50 == 0 else 0}" for i in range(200)]
    p.write_text("\n".join(rows) + "\n")
    src = Source(key="toy", kind="hf_file", repo="x/y", files=("toy.csv",), license="CC0", citation="c", label_col="isFraud", label_pos=1, domain="d")
    e = fetch.profile(src, [p])
    assert e["rows"] == 200
    assert e["label"]["positives"] == 4
    assert abs(e["label"]["prevalence"] - 0.02) < 1e-12
    assert e["files"][0]["sha256"] == fetch.sha256_file(p)


def test_profile_handles_string_labels_and_json(tmp_path: Path):
    p = tmp_path / "t.json"
    p.write_text(json.dumps([{"text": "a", "label": "FRAUD"}, {"text": "b", "label": "NOT_FRAUD"}, {"text": "c", "label": "FRAUD"}]))
    src = Source(key="toy", kind="hf_file", repo="x/y", files=("t.json",), license="CC0", citation="c", label_col="label", label_pos="FRAUD", domain="d")
    e = fetch.profile(src, [p])
    assert e["rows"] == 3 and e["label"]["positives"] == 2


def test_verify_only_fails_on_sha_mismatch(tmp_path: Path):
    raw = tmp_path / "raw"
    (raw / "toy").mkdir(parents=True)
    f = raw / "toy" / "toy.csv"
    f.write_text("a,b\n1,2\n")
    manifest = {"sources": {"toy": {"files": [{"name": "toy.csv", "sha256": fetch.sha256_file(f)}]}}}
    assert fetch.verify(manifest, raw) == []
    f.write_text("a,b\n1,3\n")
    assert fetch.verify(manifest, raw) == ["toy/toy.csv: sha256 mismatch"]
    mp = tmp_path / "MANIFEST.json"
    mp.write_text(json.dumps(manifest))
    assert fetch.main(["--verify-only", "--raw-dir", str(raw), "--manifest", str(mp)]) == 1


def test_already_ok_skips_when_sha_matches(tmp_path: Path):
    raw = tmp_path / "raw"
    (raw / "toy").mkdir(parents=True)
    f = raw / "toy" / "toy.csv"
    f.write_text("x\n")
    src = Source(key="toy", kind="hf_file", repo="x/y", files=("toy.csv",), license="CC0", citation="c", label_col=None, label_pos=None, domain="d")
    assert fetch._already_ok(src, {"sources": {}}, raw) is False
    assert fetch._already_ok(src, {"sources": {"toy": {"files": [{"name": "toy.csv", "sha256": fetch.sha256_file(f)}]}}}, raw) is True
