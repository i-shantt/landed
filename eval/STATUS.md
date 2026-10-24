# STATUS.md — overnight run 2

Stopped: see the last line of `BUILD_LOG.md`. Written 2026-10-24 ~03:20 PT, updated at the final tag `v1-overnight-2`.

## TL;DR

Everything in the run-2 brief is done: Phase A (verified, hardened, secrets set), Phase B (frontend redesign, 10 pages), deploy (Vercel + Convex production), the track audit (`TRACKS.md`, `DEVPOST.md`, README sections), and all 13 Phase C items. The gate `scripts/verify.sh` is green: **91 vitest tests, 30/30 eval runs, `next build` clean**. The core engine files were not modified; the `v0-core-works` tag marks the pre-run state.

## Deployed

| What | Where |
|---|---|
| App (Vercel production, public) | https://landed-blue.vercel.app |
| Backend (Convex production) | https://tremendous-malamute-864.convex.cloud · HTTP actions https://tremendous-malamute-864.convex.site |
| Vercel project | `landed` (team `i-shantts-projects`); preview URLs require Vercel login, the production alias does not |
| Prod secrets | set on the Convex prod deployment; `PROD_*` copies in `web/.env.local` (gitignored) |

Prod was smoke-tested with `node scripts/checkpoint2.mjs --prod` (passed) and every bundled scenario was run through judge mode on prod (see BUILD_LOG), then reseeded.

## Commands

```bash
# local
cd web && npx convex dev            # terminal 1
cd web && npm run dev               # terminal 2 → http://localhost:3000
cd web && node scripts/sync-env.mjs # mirror .env.local keys into the dev deployment (adds --generate for new secrets)

# gate (vitest + eval + next build)
bash scripts/verify.sh              # or: cd web && npm run verify

# individually
cd web && npx vitest run
cd eval && .venv/bin/python runner.py --base http://127.0.0.1:3211 --key "$EVAL_KEY"   # EVAL_KEY from web/.env.local
cd eval && .venv/bin/python runner.py --extractor claude --skip-off   # whole suite through the Claude extractor
cd web && node scripts/checkpoint2.mjs            # UI-path smoke test (dev); add --prod for production

# deploy / prod ops
cd web && npx convex deploy -y && npx vercel --prod --yes
cd web && node scripts/sync-env.mjs --prod        # prod env from .env.local (PROD_* for secrets)
cd web && node scripts/prod-seed.mjs              # re-seed prod (POST /eval/reset with the prod EVAL_KEY)
cd web && node scripts/checkpoint2.mjs --prod     # smoke test prod
cd web && node scripts/make-fixture-pdfs.mjs      # regenerate fixture invoice PDFs
python3 scripts/bundle-scenarios.py               # after editing eval/scenarios/*.yaml (judge mode bundle)
```

## Phase A — done (commits `32c8674`, `04c9a42`)

Baseline verified and tagged `v0-core-works`; random `ACCOUNT_HMAC_KEY` / `ACCOUNT_ENC_KEY` / `EVAL_KEY` on the dev deployment (old `dev` key now 401), reseeded; per-kind jump buttons via the additive `convex/timerQueries.ts`; Pay refusals in plain English (already) with the `payment_refused` event in the timeline; README/DEMO wording for invoice-follow; `scripts/verify.sh` gate.

## Phase B — done (commit `b4eb82b`)

Shell (sidebar, top bar with clock chip + mode chips + slim strip), `/cases`, `/cases/[id]` (timeline hero, right rail), `/vendors`, `/vendors/[id]`, `/mailbox` (two panes, client-side search), `/settings`, `/eval`, `/cases/[id]/package`, portal pages, `/exceptional-release`. `components/landed/*`, `lib/hooks`, `lib/labels.ts` + `lib/enums.ts` with a test that every enum has a label. Geist/Geist Mono, #FAFAF9 / slate / #1E3A8A, tabular numerals, no motion beyond 150 ms, reduced-motion respected. 390 px: no horizontal scroll on the checked pages. The `frontend-design` skill and 21st.dev were not installed; the written direction was followed.

## Deploy — done (commit `8edd472`)

## Track audit — done (commit `9361e78`): `TRACKS.md`, `DEVPOST.md`, README sections. Gaps that need a human: Cartesia (record one call), Apify (real domain + token), Anthropic "real problem" (talk to an AP practitioner). Nessie verified live on prod (deposit `273b7a8d-1d4f-42dd-aa5c-e2ed40b0a91d`).

## Phase C — all 13 done

| # | Item | Commit | Notes |
|---|---|---|---|
| gap | `/about` page (permissions, real vs simulated, how we know, seat line, invariants) | `c7d48b9` | |
| 1 | Judge mode `/judge` + `convex/judge.ts` | `a2a8be1`, `fa866b9` | Runs any of the 21 bundled or 3 custom scenarios; re-seeds first; AI-off toggle; live steps + timeline. Validated on prod across all scenarios. |
| 2 | Autoplay with captions `?autoplay=1` | `ff49db3` | `lib/captions.ts`; Pause/Prev/Next; reduced motion |
| 3 | Explain this decision | `f351dc3`, `f7ed4d3` | Claude (low effort, grounded) or template |
| 4 | Fixture invoice PDFs (pdf-lib) | `84562f7` | pdf-parse v2 as a Convex external package; both PDFs parse through intake; Claude extractor verified on the footer PDF |
| 5 | Discovered-vs-record cross-check + simulate discovery | `d415361` | |
| 6 | Case export (JSON + printable) | `2b0d906` | |
| 7 | Eval SVG bars + run history | `9a4300a` | |
| 8 | Nessie transfer viewer | `1e6f6b2` | shown only when rail = nessie |
| 9 | Vapi dry run | `a2a8be1` | `VOICE=vapi VAPI_DRY_RUN=1` → `voice_dry_run` event; tested |
| 10 | Landing-check UX | (Phase B) | PaymentCard countdown + landing-mode simulate control |
| 11 | Accessibility pass | (Phase B/C) | skip link, aria-labels, focus rings, reduced motion |
| 12 | README architecture (Mermaid) | `0de7882` | |
| 13 | Hardening tests | `0de7882` | canRelease property tests, 200-email extractor fuzz |

## Attempted and reverted

None reverted. Two detours: pdf-parse v1 could not read pdf-lib PDFs (upgraded to v2 + `convex.json` externalPackages + DOM polyfills); the Claude narration first returned an empty text block because thinking tokens consumed `max_tokens: 400` (now 3000, effort low).

## Core files

Not modified tonight: `guard.ts`, `cases.ts`, `payments.ts`, `probes.ts`, `confirmations.ts`, `bankAccounts.ts`, `contacts.ts`, `timers.ts`, `clock.ts`, `events.ts`, `crypto.ts`, `schema.ts`. No `core-fix:` commits were needed.

## For the morning (human)

1. Push the repo public; take the three screenshots listed in `DEVPOST.md`; record the video (`Play with captions` on the compromised-inbox case gives the first 15 seconds).
2. Decide Cartesia: set `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `CARTESIA_VOICE_ID`, `TEST_PHONE_NUMBERS=+1<teammate>` on the deployment (`node scripts/sync-env.mjs --prod`), set voice to `vapi` in Settings, run one case to availability, take the call. Try `VAPI_DRY_RUN=1` first to see the exact request as a `voice_dry_run` event.
3. Decide Apify: add a real vendor domain to the fixtures and `APIFY_TOKEN`, or drop the track.
4. Talk to one AP practitioner; quote them in `DEVPOST.md`.
5. Vercel login is already done on this machine (`i-shantt`); nothing to do unless you redeploy from another machine.

## Known rough edges

- Judge mode and the eval runner both re-seed the database; do not run them during a live demo on the same deployment (use prod for the demo, local for runs, or vice versa).
- The browser window used for checks was 500 px wide, so the overnight screenshots show the mobile layout; the fork measured desktop and 390 px separately.
- `/eval` on a freshly reseeded prod shows the last posted run only if results were posted to prod (`runner.py --base <prod site> --key <PROD_EVAL_KEY>`); judge-mode runs also appear there.
