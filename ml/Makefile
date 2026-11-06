# Landed ML pipeline. Every target is idempotent; `make all` from a clean checkout reproduces artifacts/.
PY := .venv/bin/python -I
.PHONY: all venv fetch features train evaluate scenarios export card sync test clean

all: venv fetch features train export scenarios evaluate card sync

venv: .venv/.ok
.venv/.ok: requirements.txt
	python3 -m venv .venv
	.venv/bin/python -m pip install -q --upgrade pip
	.venv/bin/python -m pip install -q -r requirements.txt
	touch .venv/.ok

fetch: venv
	$(PY) data/fetch.py --skip-optional

features: venv
	$(PY) prepare.py

train: venv
	$(PY) train.py

export: venv
	$(PY) export.py

scenarios: venv
	$(PY) scenarios/generate.py

evaluate: venv
	$(PY) evaluate.py

card: venv
	$(PY) model_card.py

sync:
	cd ../web && node scripts/sync-model-metrics.mjs

# Operator feedback: export dispositions + send-time features from a deployment, then score the shipped model on them.
feedback: venv
	cd ../web && node scripts/export-labels.mjs $(if $(PROD),--prod,)
	$(PY) -I feedback.py data/feedback/labels-$(if $(PROD),prod,dev).jsonl --out artifacts/feedback_report.md

test: venv
	$(PY) -m pytest tests -q

clean:
	rm -rf data/interim artifacts/models
