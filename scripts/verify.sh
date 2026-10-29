#!/usr/bin/env bash
# Gate: vitest, eval runner, next build. Exits non-zero on the first failure.
# Usage: scripts/verify.sh [--skip-eval] [--skip-build]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_EVAL=0; SKIP_BUILD=0
for a in "$@"; do
  case "$a" in --skip-eval) SKIP_EVAL=1;; --skip-build) SKIP_BUILD=1;; esac
done
echo "== vitest"
(cd "$ROOT/web" && npx vitest run 2>&1 | grep -E "^ +(Tests|Test Files) ") || { echo "vitest FAILED"; exit 1; }
(cd "$ROOT/web" && npx vitest run >/dev/null 2>&1) || { echo "vitest FAILED"; exit 1; }
if [ "$SKIP_EVAL" = "0" ]; then
  echo "== eval"
  EVAL_KEY_VAL="$(grep -E '^EVAL_KEY=' "$ROOT/web/.env.local" 2>/dev/null | cut -d= -f2- || true)"
  SITE="$(grep -E '^NEXT_PUBLIC_CONVEX_SITE_URL=' "$ROOT/web/.env.local" | cut -d= -f2-)"
  PY="$ROOT/eval/.venv/bin/python"; [ -x "$PY" ] || PY=python3
  (cd "$ROOT/eval" && "$PY" runner.py --base "${SITE:-http://127.0.0.1:3211}" --key "${EVAL_KEY_VAL:-dev}" 2>&1 | grep -E "^FAIL|passed") || true
  grep -q '"passed": false' "$ROOT/eval/results.json" && { echo "eval FAILED"; exit 1; } || true
  python3 -c "import json,sys; r=json.load(open('$ROOT/eval/results.json')); bad=[x['scenarioId'] for x in r if not x['passed']]; sys.exit(1 if bad else 0)" || { echo "eval FAILED"; exit 1; }
fi
echo "== measured numbers (README/DEVPOST vs eval/results.json)"
(cd "$ROOT/web" && node scripts/sync-measured.mjs --check) || { echo "measured numbers STALE: run node web/scripts/sync-measured.mjs"; exit 1; }
echo "== model metrics (README vs ml/artifacts/metrics.json)"
(cd "$ROOT/web" && node scripts/sync-model-metrics.mjs --check) || { echo "model metrics STALE: run node web/scripts/sync-model-metrics.mjs"; exit 1; }
if [ "$SKIP_BUILD" = "0" ]; then
  echo "== next build"
  (cd "$ROOT/web" && npx next build >/tmp/landed-next-build.log 2>&1) || { tail -30 /tmp/landed-next-build.log; echo "next build FAILED"; exit 1; }
  grep -E "✓ Compiled|Compiled successfully" /tmp/landed-next-build.log | head -1
fi
echo "VERIFY OK"
