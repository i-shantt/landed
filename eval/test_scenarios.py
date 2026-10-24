"""pytest wrapper: `pytest eval/` runs the runner once and asserts each scenario passed."""
import json, subprocess, sys
from pathlib import Path
import pytest

HERE = Path(__file__).parent

@pytest.fixture(scope="session")
def results():
    subprocess.run([sys.executable, str(HERE / "runner.py"), "--no-report"], check=False)
    return json.loads((HERE / "results.json").read_text())

def pytest_generate_tests(metafunc):
    if "scenario_id" in metafunc.fixturenames:
        p = HERE / "results.json"
        ids = [r["scenarioId"] for r in json.loads(p.read_text())] if p.exists() else []
        metafunc.parametrize("scenario_id", ids)

def test_scenario(results, scenario_id):
    r = next(x for x in results if x["scenarioId"] == scenario_id)
    assert r["passed"], r["failures"]
