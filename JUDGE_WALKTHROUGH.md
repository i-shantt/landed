# JUDGE_WALKTHROUGH.md — five simulated judges against production (2026-10-24, 03:55–04:20 PT)

Driven in Chrome at 1440×813 against https://landed-blue.vercel.app from a clean seed, following `DEMO.md` as a stranger would. Harsh by design. Items marked **FIX-n** feed the ranked list at the end.

## 1. Cal Hacks general judge (4 minutes, 30 projects seen, does not know AP)

- First screen `/cases` on a clean seed: three zero stat cards and "No cases yet." Nothing tells them who this is for or what they are looking at. The sidebar footer line ("No payment to an account that is not verified…") is 11px grey in the corner. **FIX-1** (seed demo cases so the first screen has a story) and **FIX-5** (one-paragraph explainer for someone who has never heard "accounts payable").
- Vocabulary with no definition on screen: DMARC, ACH, "probe", "contact of record", "vendor master", SLA, "rail". The Mailbox says "SPF/DKIM/DMARC pass" with no hint. **FIX-4** (hover definitions).
- Mailbox → send worked in one click (vendor defaults to CleanCo). Thread list shows dates like "Oct 25, 14:03 PT" while the clock says Oct 24: future-dated history looks like a bug. **FIX-6**.
- `/cases` after sending: clear. "Probe sent" badge, $42,000 blocked, trigger in plain English. Good.
- Case page: the timeline reads well and the one-sentence summary under the title is the best copy on the site. But at 1440×813 the **Pay button is below the fold**, after a "Simulated vendor answer" panel that is irrelevant until the probe is available. A judge watching the pitch sees the simulation box before the thing the pitch is about. **FIX-3** (Actions first; simulated-answer panel only when it applies).
- Advancing time needs the clock chip → sheet → two buttons → close. The narrator has to explain the clock twice. **FIX-2** (one button on the case page: "Fast-forward the bank to the next step").
- Pay refusal: red, plain English, the enum in grey mono next to it. Good. Timeline shows it. Good.
- "Play with captions" / "Replay timeline": discoverable, labels fine.
- Nothing crashed; no spinner lasted more than a second on prod. Convex live updates made the clock jump feel instant.

## 2. Hyphenate judge (real enough / hire it / new / the moment)

- "Run your own scenario": `/judge` is clean and the custom templates are at the top. Run → live steps → PASS in ~15 s. The embedded timeline is live. Good. Missing: scenarios a finance person would actually try (insistent legit vendor, a bank letter PDF, two-day silence, wrong-vendor payment). **FIX-8** (judge scenario pack with one-sentence outcomes).
- "What if the email is legit?" The answer exists (custom_legit_change) but the pitch needs a **pre-run legitimate case** on `/cases`, not a 60-second run. **FIX-1**.
- "What stops your AI from approving it?" `/about` permissions table answers it; it is one click in the sidebar but not linked from the place the question arises (the case page Actions). **FIX-7** (link from Actions: "What the agent cannot do").
- Audit trail for one case: the timeline plus Export JSON / Printable view. Strong.
- "The moment": nothing-arrived → NEEDS_HUMAN → Pay refused is visible in the timeline with the attacker's email marked ignored. Strong, once the operator reaches it fast enough (FIX-2).

## 3. Microsoft FDE judge (customer, measured, path to production, responsible design, end to end)

- `/about` has the seat line, permissions, real vs simulated, "how we know". `/eval` has the metrics and per-family bars; the disclaimer sentence is the subtitle. Good.
- "What happens when Claude is wrong?" Answerable from README and the Explain panel's grounding note, but not from `/about`. **FIX-9** (add a "Where Claude could go wrong" block to `/about`, copied from README).
- The Eval metric copy is long ("Time to release for legit (demo clock, from case open to account_verified; includes…)"). Acceptable for this judge.
- End to end: yes, on prod, with live data.

## 4. Convex judge

- Real-time: the case page updated during the clock jump without a refresh; the cases list updates as cases appear. Good.
- "Show me a mutation refuse a payment": Pay → refusal → `payment_refused` event in the timeline in under a second. Good. The About page says "Permissions as enforced in the database, not as prompt instructions." Good.
- Feature inventory lives in README only. Acceptable; `/about` could carry a one-line "Built on Convex: …" **FIX-10** (one line, low effort).

## 5. Capital One judge

- Rail is `sim` by default; the Nessie panel appears only when the rail is Nessie, and switching needs Settings. The transfer exists on Nessie (verified in run 2) but a judge at the table will not see it unless the operator switches rails before the demo. **FIX-11** (RUNBOOK: how to switch to Nessie for a case and show the panel; mention integer cents). No code change needed.
- "Why integers?" Answered in the panel caveat and README.

## Ranked fix list (impact × ease)

| # | Fix | Where | Effort |
|---|---|---|---|
| FIX-1 | Seed three demo cases on every reset (legit CLOSED, RECOVERY with package, NEEDS_HUMAN from contact+bank change); "Demo cases" group on `/cases` above the live queue | `convex/seedDemo.ts` (additive, called from seed), `/cases` | M |
| FIX-2 | One-click "Fast-forward the bank" on the case page (settle + availability, or landing check when PAID) | `convex/timerQueries.ts` + case page | S |
| FIX-3 | Right rail order: Actions first; Simulated vendor answer only when AWAITING or PAID | case page | S |
| FIX-4 | Hover definitions for DMARC, ACH, probe, contact of record, vendor master, SLA, rail | `components/landed/Term.tsx` | S |
| FIX-5 | First-screen explainer for non-finance readers | `/cases` header | S |
| FIX-6 | No future-dated fixture messages | `fixtures/generate.py` | S |
| FIX-7 | "What the agent cannot do" link in the Actions card | case page | S |
| FIX-8 | Judge scenario pack (5) with one-sentence outcomes | `eval/scenarios/judge_*.yaml`, bundle | M |
| FIX-9 | "Where Claude could go wrong" on `/about` | `/about` | S |
| FIX-10 | "Built on Convex" line on `/about` | `/about` | S |
| FIX-11 | Runbook step for showing Nessie | `RUNBOOK.md` | S |
