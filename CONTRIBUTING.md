# Contributing

Landed is a small codebase with one hard rule: nothing moves money except `payments.send`, and nothing changes the files that enforce that without a failing test first.

## Setup

```bash
cd web && npm ci
npx convex dev                          # attaches a dev deployment, writes .env.local
node scripts/sync-env.mjs --generate    # encryption, eval and Convex Auth keys for that deployment
npm run dev                             # http://localhost:3000/signin → "Create account" (first user = admin)
npx convex run authSetup:ensureDemoAccounts   # optional demo accounts shown on /signin
```

Python (optional): `python3 -m venv eval/.venv && eval/.venv/bin/pip install -r eval/requirements.txt` for the scenario suite; `make -C ml venv` for the ML pipeline.

## The gate

Run before every push:

```bash
bash scripts/verify.sh            # vitest → 40-run scenario suite (live dev deployment) → measured + model-metric checks → next build
bash scripts/verify.sh --skip-eval --skip-build   # quick loop
npm run e2e                       # Playwright smoke against localhost:3000 (not in the gate: needs a browser)
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, vitest, the two doc checks and the build on every push and pull request, plus the ML unit tests. The scenario suite needs a live deployment and `EVAL_KEY`, so it stays in `verify.sh`. The Playwright job runs when the repository variables `E2E_CONVEX_URL` and `E2E_CONVEX_SITE_URL` point at a dev deployment that has the fixtures and demo accounts. `ml.yml` is manual and reproduces `ml/artifacts/metrics.json` from public data on a clean runner.

## Rules

- **Frozen core** (`web/convex/guard.ts, cases.ts, payments.ts, probes.ts, confirmations.ts, bankAccounts.ts, contacts.ts, timers.ts, clock.ts, events.ts, crypto.ts, schema.ts`): change only with a failing test committed first, in a commit prefixed `core:` (behaviour) or `core-fix:` (security). Everything else is additive: new modules, new queries, new pages.
- **One feature, one commit.** Commit messages name the change and the test count (`controls: … ; 4 tests`). Prefixes in use: `core:`, `core-fix:`, `controls:`, `risk:`, `monitoring:`, `auth:`, `web:`/`ui:`, `api:`, `ml:`, `tests:`, `ops:`, `ci:`, `infra:`, `e2e:`, `docs:`, `status:`, `eval:`, `chore:`.
- **Numbers come from artifacts.** The measured paragraph in `README.md`/`DEVPOST.md` is written by `web/scripts/sync-measured.mjs` from `eval/results.json`; the model block by `web/scripts/sync-model-metrics.mjs` from `ml/artifacts/metrics.json`. Never edit them by hand, and never edit a scenario's expectations to make it pass.
- **Secrets.** Probe amounts never leave the server; account numbers never reach the browser; nothing secret in git or logs. `web/.env.local` is ignored and holds dev and `PROD_*` values; `node scripts/sync-env.mjs [--prod]` pushes them to a deployment.
- **Identity.** Who acts comes from the session (`controls/actor.ts` → `requireActor`). No function takes an operator id from the client; `tests/security.test.ts` fails if one does. Tests act as operators through `asUser(t, role)` / `actors(t)` in `tests/harness.ts`.
- **Downloaded data is untrusted.** `ml/data/raw` is ignored; scripts run with `python -I` and only pandas reads the files.

## Layout

`web/` Next.js 16 app and Convex backend (`web/convex`), `eval/` the scenario runner, `ml/` the training pipeline, `fixtures/` the seeded vendor master, `scripts/verify.sh` the gate. `ARCHITECTURE.md` explains the boundary; `SECURITY.md` lists every public function and why it is safe.
