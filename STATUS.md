# STATUS.md

Updated 2026-10-25 (post-judging platform build). The hackathon demo is no longer locked; `main` carries the full platform: risk engine, controls (operators, approvals, policy, demo kill switch), sanctions screening, dashboard and payments ledger, REST API v1 + signed webhooks, Nacha/ISO 20022 payment files, controls matrix, security hardening and the frontend review fixes. See `CHANGELOG.md` (what), `ARCHITECTURE.md` (how), `SECURITY.md` (public surface).

## Live now

- **Repo:** https://github.com/i-shantt/landed — `main` at the platform build (gate green: 213 vitest, 40/40 eval, measured check, next build).
- **Production has NOT been redeployed yet with the platform build.** Vercel is still `dpl_DfnsVAjSqH4TJpoZ6eHiN8R6M7zn` (https://landed-blue.vercel.app) and Convex prod functions are still at `ea5fd57` (hackathon demo + voice fix). Prod env already has `VAPI_WEBHOOK_SECRET` set (random, recorded as `PROD_VAPI_WEBHOOK_SECRET` in `web/.env.local`).
- **To deploy** (from a clean checkout of `main`; the prepared worktree is the scratchpad `deploytree`):
  ```bash
  cd web && npm ci
  npx convex deploy -y                              # schema adds 9 tables; no data migration needed
  npx vercel --prod --yes                           # note the dpl_ id for rollback
  npx convex run --prod controls/operators:ensureSeeded   # operators on the existing prod data (reseed also does it)
  node scripts/checkpoint2.mjs --prod               # smoke test
  node scripts/prod-seed.mjs                        # clean demo state (20 vendors, 3 demo cases, operators)
  ```
  Then on prod: pick an administrator in the top-bar operator menu, `/controls` → Apply recommended, `/developers` → Add built-in inbox (webhooks), `/controls` → Screen all vendors.
- **Rollback:** `cd web && npx vercel rollback dpl_DfnsVAjSqH4TJpoZ6eHiN8R6M7zn`; functions: `git checkout ea5fd57 -- web/convex && (cd web && npx convex deploy -y) && git checkout main -- web/convex`.

## What to do next (suggested)

1. **Real identity**: add Convex auth (Clerk or WorkOS) and map identities to `operators`; keep every server rule. This closes the one known structural gap (see `SECURITY.md` → Known limits).
2. **Bulk actions and saved views** on `/cases`; an `/invoices` page; a NEEDS_HUMAN decision helper card.
3. **Production watchlist**: load OFAC `SDN.CSV`/`ALT.CSV` with the parsers in `convex/screening/watchlist.ts` on a schedule and re-screen the vendor master on every list change.
4. **Bank connector**: pull `GET /api/v1/payment-files/{id}` with a `files:read` key from the bank's SFTP job; probe deposits as `ACCTVERIFY` Micro-Entries through the same builder.
5. **Voice**: with `VAPI_WEBHOOK_SECRET` now required, re-run the dev voice check (`voice=vapi`, test number as the contact of record) to place a real call; the webhook only accepts messages for calls Landed placed.

## Rollback (recorded at the start of run 3; use if a later deploy misbehaves)

- Vercel known-good before run 3: `dpl_BqExTbLvAaYDGC8GvY441xR2GqVR` → `cd web && npx vercel rollback dpl_BqExTbLvAaYDGC8GvY441xR2GqVR`.
- Convex functions known-good before run 3: git `aec7deb` (`v1-overnight-2`) → `git checkout v1-overnight-2 -- web/convex && (cd web && npx convex deploy -y) && git checkout main -- web/convex`.
- **Repo:** https://github.com/i-shantt/landed (public since Sat 2026-10-24 morning).
- **Live now:** Vercel `dpl_DfnsVAjSqH4TJpoZ6eHiN8R6M7zn` (https://landed-gaa9uyt2s-i-shantts-projects.vercel.app → https://landed-blue.vercel.app) and Convex prod functions at `main` `ea5fd57` (new frontend from PR #1 + voice request fix, inert while voice=sim). Previous: Vercel `dpl_7XxM6WAYaDSEwKVZQrkXM72VQTbb`. Previous known-good: Vercel `dpl_TZ8bL7cqb7NgEZYrzuWKPjivYbNS`, functions at tag `v2-overnight-3`. Each run-3 deploy was built from a clean git worktree of the committed tree, gated by `scripts/verify.sh`, and smoke-tested with `node scripts/checkpoint2.mjs --prod` after deploy; prod was reseeded with the demo cases afterwards.

## What is live

| What | Where |
|---|---|
| App (public) | https://landed-blue.vercel.app |
| Backend | Convex prod `tremendous-malamute-864` (HTTP: `https://tremendous-malamute-864.convex.site`, `/health` is public) |
| Demo state | reset creates three demo cases (legit landed, fraud + package, bank+phone → human); CleanCo open $42,000 invoice; extractor `claude` |

## Phases

- **D (judge-proofed)**: five walkthroughs (`JUDGE_WALKTHROUGH.md`), fixes shipped: demo cases on reset, one-click Fast-forward on the case page, right-rail order, hover definitions (`Term`), first-screen explainer, "What the agent cannot do" link, About additions, judge scenario pack (`judge_01…05`, validated), attachment evidence, bank-letter PDF fixture, fixture dates clamped. `JUDGE_QA.md` (25). `DEMO.md` pitches at 2:00 / 0:60 / 4:00.
- **E (assets)**: `assets/video/landed-raw.webm` + `judge-run.webm` + `NARRATION.md`; `assets/screenshots/` (six); `/pitch` deck + `assets/pitch.pdf`; `RUNBOOK.md`; `TEAM_ONBOARDING.md`; demo-state seeding.
- **F (security/resilience)**: `SECURITY.md` + static tests; portal lockout (5 fails/15 min), httpOnly/secure/sameSite session cookie via Next route handlers, attempts/expiry enforced server-side; `/health` page + endpoint; probe-amount endpoint 404 on prod (dev needs `EVAL_PROBE_AMOUNT_ENDPOINT=1`); soak 20/20 on prod (median 0.6 s to case); npm audit 0; clean clone builds; per-client rate limits on portal login/confirm and eval endpoints.
- **G (expansions)**: G1 `/payment-run` (+ preview backend, two eval scenarios), G2 `.eml` upload (postal-mime, two sample files), G3 `/vendors/new` onboarding, G4 `/audit` with hash chain and CSV/JSON export, G7 per-client rate limits. G5 done late in the run (Claude-rewritten thread bodies under fact checks, deterministic fallback kept). Skipped with reason in `OPEN_QUESTIONS.md`: G6 (simulated provider coverage needs a core change). G8 second judge simulation: see `JUDGE_WALKTHROUGH.md` → "Second pass".

## Commands

```bash
bash scripts/verify.sh                                   # gate: vitest + eval + next build
cd web && npx vitest run                                 # tests only
cd eval && .venv/bin/python runner.py --key $EVAL_KEY    # eval on the local deployment (needs EVAL_PROBE_AMOUNT_ENDPOINT=1 there)
cd web && node scripts/soak.mjs --prod --runs 20         # flakiness run on prod (reseeds with demo at the end)
cd web && node scripts/checkpoint2.mjs --prod            # prod smoke test
cd web && node scripts/prod-seed.mjs                     # reset prod to the clean demo state
cd web && node scripts/record-demo.mjs                   # re-record video + screenshots on prod
cd web && node scripts/pitch-pdf.mjs                     # re-export assets/pitch.pdf
cd web && npx convex deploy -y && npx vercel --prod --yes   # redeploy (after the gate)
cd web && npx vercel rollback <deployment id>            # roll back the app
```

## Known rough edges

- Judge mode and the eval runner re-seed the database; run them on a deployment that is not mid-demo. The runbook's clean-state step restores the demo cases.
- The demo history is built with the clock started seven days in the past and brought back to real time at the end of seeding, so a reset shows no future dates; a fresh live probe queues for the next ACH window (Monday 13:30 ET from a weekend) and Fast-forward is still one click.
- Portal pages poll every 5 s (no live subscription) since the session cookie is httpOnly.
- `.webm` only (no ffmpeg).
