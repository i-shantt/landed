# RUNBOOK.md — at the table (Sunday 10:30–12:30)

Laptop setup before judging: Chrome with two tabs pinned: **A** https://landed-blue.vercel.app/cases and **B** https://landed-blue.vercel.app/judge. A third tab on `/pitch` fullscreen for the talking slides. Zoom the browser to 110%.

## Fallback ladder

1. **Live prod** (default): https://landed-blue.vercel.app → Convex prod `tremendous-malamute-864`.
2. **Local dev with SimRail**: `cd web && npx convex dev` (terminal 1), `cd web && npm run dev` (terminal 2), open http://localhost:3000. Same UI, same seed (`Settings → Re-seed`). Needs only the laptop.
3. **Replay mode** (no network at all after the first load): open any demo case, click **Replay timeline** or **Play with captions**. The page read the events once; it keeps playing if the connection drops. The captioned autoplay of the fraud demo case is the pitch's first 20 seconds.

## Clean demo state (do this before each judge)

- Prod: `cd web && node scripts/prod-seed.mjs` (POST `/eval/reset` with `{which:"full", demo:true}`; ~10 s). Or in the app: **Settings → Re-seed fixtures → confirm**.
- Local: Settings → Re-seed fixtures.
- Re-seed creates the three **Demo cases** (shown above the live queue on `/cases`): a legitimate change that landed (CLOSED), a fraud with a recovery package (RECOVERY), and a bank+phone change waiting for a human (NEEDS_HUMAN). The live queue is empty, CleanCo has its $42,000 invoice open, extractor is `claude` on prod.
- Warm-up: open `/cases` and one demo case once before the first judge (first request after idle can take ~2 s).

## The demo-clock sequence

The demo clock lives in the top-right chip. After a bank-change email, the only time step you need is on the case page: **Fast-forward the bank** (in the Probe card) takes the probe to "available to the vendor" in one click; after Pay, the same button takes you to the landing check. The chip's sheet has +1 hour / +1 business day / jump buttons if you need finer control.

## If something looks stuck

Open https://landed-blue.vercel.app/health: deployment, seed time, demo clock, last tick, unfired timers, modes, key presence. If `unfired timers` is large and the clock is not moving, click **+1 hour** once. If intake is slow (Claude), switch **Settings → Extractor → rules** (instant, same demo).

## If wifi dies mid-demo

Stay on the page; replay mode keeps working from what is loaded. If you need a fresh case, switch to the local stack (ladder step 2) which needs no internet except for Claude (rules extractor works offline).

## If Vercel or Convex is down

Local stack (ladder step 2). The local Convex deployment is in `web/.env.local`; `npx convex dev` starts it. Seed with Settings → Re-seed.

## Showing Nessie to the Capital One judge

Settings → Rail → `nessie`, then send a bank-change email (or edit an account). The case page shows a **Nessie transfers** panel with a Load button: the deposit id, amount in integer cents (Nessie stores integers), description `ACCTVERIFY (amount in cents: NN)`. Switch back to `sim` afterwards. The probe amount is still secret: the panel shows the Nessie record only after the vendor statement step, or say "we show the record after the vendor has answered" and skip it.

## Judge wants to run their own scenario

Tab B `/judge`: pick one of the five **Judge scenarios** (insistent legit vendor, bank letter PDF, bank+phone change, two-day silence, wrong vendor) or any eval scenario → **Run**. It re-seeds (demo cases vanish; re-seed with `demo` afterwards), runs every step, and streams the timeline. Or let them type an email in the Mailbox with any account number: the case opens, Pay is refused, Fast-forward, Simulate vendor answer → their choice.

## Redeploy (last-minute fix)

```bash
bash scripts/verify.sh                       # must be green
cd web && npx convex deploy -y && npx vercel --prod --yes
cd web && node scripts/checkpoint2.mjs --prod && node scripts/prod-seed.mjs
```

## Roll back

```bash
cd web && npx vercel rollback dpl_BqExTbLvAaYDGC8GvY441xR2GqVR     # or: npx vercel ls --prod, then npx vercel promote <url>
git checkout v1-overnight-2 -- web/convex && (cd web && npx convex deploy -y) && git checkout main -- web/convex
```

## Phone numbers and keys

Nothing is dialed (voice is `sim`). Keys live only in `web/.env.local` and the Convex deployment env. The eval endpoints need `x-eval-key`; the prod key is `PROD_EVAL_KEY` in `web/.env.local`.
