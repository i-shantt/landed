# STATUS.md — overnight run 3

Stopped 2026-10-24 04:45 PT. Phases D–G done; the Phase G list is exhausted except the two items skipped with reasons. Final tag `v2-overnight-3`.

## Morning items (human only)

1. **Push the repo public** (your GitHub auth) and paste the link into Devpost. Secrets scan was clean in run 2; `.env.local`, `.vercel/`, `.convex/` are ignored.
2. **Narrate the video**: `assets/video/landed-raw.webm` with `assets/video/NARRATION.md` (timestamps at the bottom), or re-record live from `/cases/<fraud demo case>?autoplay=1` (the "Play with captions" button). No ffmpeg on this machine, so it is `.webm`.
3. **Cartesia/Vapi**: one real call with a teammate's number. Set `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `CARTESIA_VOICE_ID`, `TEST_PHONE_NUMBERS=+1…` in `web/.env.local`, run `cd web && node scripts/sync-env.mjs --prod`, set Voice to `vapi` in Settings, try `VAPI_DRY_RUN=1` first (a `voice_dry_run` event shows the exact request), then run a case to availability.
4. **Apify**: decide; if yes, add one real vendor domain to the fixtures and `APIFY_TOKEN`, then "Discover from website" on that vendor.
5. **Talk to one AP practitioner** (a finance sponsor booth counts) and quote them in `DEVPOST.md` → Problem.
6. **Devpost**: draft by Saturday 11:30 PM, final by Sunday 8:30 AM. Text is in `DEVPOST.md`; screenshots in `assets/screenshots/`; deck `assets/pitch.pdf`.

## Rollback (recorded at the start of run 3; use if a later deploy misbehaves)

- Vercel known-good before run 3: `dpl_BqExTbLvAaYDGC8GvY441xR2GqVR` → `cd web && npx vercel rollback dpl_BqExTbLvAaYDGC8GvY441xR2GqVR`.
- Convex functions known-good before run 3: git `aec7deb` (`v1-overnight-2`) → `git checkout v1-overnight-2 -- web/convex && (cd web && npx convex deploy -y) && git checkout main -- web/convex`.
- **Repo:** https://github.com/i-shantt/landed (public since Sat 2026-10-24 morning).
- **Live now:** Vercel `dpl_7XxM6WAYaDSEwKVZQrkXM72VQTbb` (https://landed-4tk8j3sxb-i-shantts-projects.vercel.app → https://landed-blue.vercel.app) and Convex prod functions at `main` (Saturday clock fix). Previous known-good: Vercel `dpl_TZ8bL7cqb7NgEZYrzuWKPjivYbNS`, functions at tag `v2-overnight-3`. Each run-3 deploy was built from a clean git worktree of the committed tree, gated by `scripts/verify.sh`, and smoke-tested with `node scripts/checkpoint2.mjs --prod` after deploy; prod was reseeded with the demo cases afterwards.

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
