# TEAM_BRIEF.md — read this first (Saturday, Oct 24, 2026)

Written for the two teammates joining today. It covers what Landed is, what exists, the rules of the repo, how to get running in 15 minutes, and what each of us does today. Deadline is **Sunday 9:00 AM PT** (Devpost). Judging is **Sunday 10:30 to 12:30**, a 2-minute pitch plus a live demo. Everything below is already built and deployed; today is about the pitch, the video, the Devpost, the live-call track, and finding anything that breaks in front of a judge.

Live app: **https://landed-blue.vercel.app**  ·  Repo: **https://github.com/i-shantt/landed** (public)

---

## 1. The problem, in the words we use with judges

Companies pay vendors to whatever bank account sits in the vendor record. Business email compromise (BEC) works by getting that one field changed: a fraudster writes to accounts payable from a compromised or lookalike vendor address and says "we switched banks." The invoice is real, the vendor is real, only the destination changed. FBI IC3 reported $3.05 billion in BEC losses across 24,768 complaints in 2025. Wires are irrevocable; a receiving bank may return a fraudulent ACH credit but is never required to. Recovery odds collapse after 72 hours.

The people who live this are two-person AP teams at 50-to-500-employee companies. Their vendors (cleaners, printers, freight, staffing) are too small to appear in bank-verification networks like Trustpair or Eftsure, so "account validation" returns nothing. Their only real control is a phone call to the vendor, and it gets skipped when the payment run is due.

## 2. What Landed is (one paragraph)

**Landed is a payment-control system for accounts payable. No payment can be sent to a bank account that has not been verified for that specific vendor, even when the AI misses the email, even when a clerk types the attacker's account in by hand.** Verification is a transaction challenge: Landed sends a randomized sub-dollar probe deposit (11 to 99 cents, memo `ACCTVERIFY`, the Nacha "Micro-Entry" pattern) to the new account and asks the vendor's **contact of record** (a phone number established at onboarding, never a contact taken from the request) what amount arrived. Only a number match, bound to that exact case, vendor, account version, probe and contact, flips the account to verified. After payment, Landed confirms the money landed. If it did not, it assembles the bank-recall and FBI IC3 response package in minutes.

Positioning line: *Fills the payment-verification clerk seat and the first hour of the fraud-response coordinator seat; a human still releases money.*

The two demos that matter most:
1. **AI off, clerk fooled, Pay refused.** Extractor disabled, a clerk types the fraudster's account on the vendor page, clicks Pay. The server refuses with `destination_not_verified`. No AI gets a vote.
2. **Legitimate change passes.** Probe sent, the vendor of record states the right amount, account verified, payment sent, landing confirmed, no manual verification.

Why it is different from prior art: Trouvé (SteelHacks) does a yes/no confirmation call; validation vendors check networks that skip small vendors; detection tools stop at an alert. Landed adds the number-answer challenge, a database-enforced release gate bound to vendor and account version, the landing check after payment, the recovery package, and an eval that includes the legitimate path and the AI-off path.

## 3. How it works (enough to answer questions)

- **Intake.** An email (or uploaded `.eml`, or a clerk's manual edit) that requests a bank change creates a new **unverified** account version and opens a case. The vendor's open invoices are re-pointed to the requested account and are **held**. A rules extractor and a Claude extractor (claude-sonnet-5-5, PDFs passed as documents) both exist; the demo can run with either or with the AI off.
- **Probe.** A random sub-dollar credit is queued for the next Same Day ACH window and becomes available to the vendor at 13:30, 17:00 or 18:00 receiver-local time. The amount lives in one table and one comparison. It never appears in a prompt, tool, event, log, or public query.
- **Release gate.** A stated amount counts only if it arrives through the voice channel to the number of record or through the vendor portal login. Email statements are stored and marked rejected. The gate checks case, vendor, account hash, account version, probe, availability, exact amount, contact still of record, single use and expiry, then flips the account, consumes the confirmation, transitions the case and logs, in one Convex transaction.
- **Pay.** The payment function is the only writer of payments and refuses any destination that is missing, another vendor's, unverified, disputed, superseded, or a stale version. It fails closed.
- **Landing check and recovery.** After Pay, the contact of record is asked what full amount arrived. A match closes the case as landed. A missed deadline moves the case to recovery and builds the package (bank fraud-line script, indemnification letter, IC3 narrative, Kill Chain eligibility, evidence checklist, insurer notice). Claude drafts prose; every number is checked against the facts; templates are the fallback.
- **Time is simulated.** A demo clock drives ACH windows, availability, SLAs and landing deadlines. Every timer is a row fired by one `tick`. The case page has a one-click **Fast-forward the bank** button.
- **Eight invariants (I1 to I8)**, each with a test, are listed in `README.md`. If a judge asks "what stops the AI from paying," the answer is I1 and I5: the agent has no path to `markVerified`, `payments.send`, or account status.

What is real vs simulated (say this out loud when asked): real are the engine and invariants, versioned accounts with HMAC hashing and AES-256-GCM encryption, the append-only audit log with a hash chain, both extractors, the vendor portal, the eval harness, and Nessie transfers on Capital One's mock bank. Simulated are settlement timing, the vendor's answer (typed by us or by the eval), email authentication results, and the vendor's bank statement. Every simulation is labeled on screen. The Vapi/Cartesia voice channel is written and unit-tested but has **never been dialed**. That is one of today's jobs.

## 4. What exists right now

Built over three overnight runs (git tags `v0-core-works`, `v1-overnight-2`, `v2-overnight-3`). All of it is deployed to the public URL above.

**Pages:** Cases (three pre-seeded demo cases plus the live queue), case page (timeline, destination versions, probe card, actions, Explain narration, export, printable view, replay, captions), Vendors (edit account, onboard a vendor with an attested contact of record), Mailbox (send a scripted email, upload a real `.eml`), Payment run (the week's batch with the guard's decision per line; "Run payable" pays only verified lines), Audit (every event, filters, CSV/JSON export, hash-chain check), Eval (measured results), Judge (run any of 28 scripted scenarios against this deployment and watch the case unfold), About (real vs simulated, permissions table, where Claude could go wrong), Pitch (in-app deck), Health, Settings (re-seed, rail, voice, extractor), vendor portal (login with lockout, read back the probe).

**Measured:** 106 unit and invariant tests; 28 eval scenarios run with the extractor on and off (40 runs, 40 pass, 0 false releases; every fraud blocked, every legitimate change landed with no human action other than Pay). These are scripted cases. Always add the disclaimer sentence that they do not establish effectiveness against real-world fraud.

**Assets:** `assets/video/landed-raw.webm` (1:14 raw screen take, no narration), `assets/video/NARRATION.md` (script with timestamps), `assets/screenshots/` (six, 1600×1000), `assets/pitch.pdf`.

**Docs map (read in this order):**

| File | What it is for |
|---|---|
| `DEMO.md` | The click-by-click demo script and the pitch at 2:00, 0:60 and 4:00. Rehearse from this. |
| `JUDGE_QA.md` | 25 likely judge questions with the answers we give. |
| `JUDGE_WALKTHROUGH.md` | Five simulated judges' reactions and what was fixed; "Second pass" at the end. |
| `RUNBOOK.md` | What to do when something goes wrong during the demo (fallback ladder, clean state, clock). |
| `STATUS.md` | What is live, deployment ids, rollback, rough edges, commands. |
| `TEAM_ONBOARDING.md` | Architecture picture, which concept lives in which file, how to add a scenario or page. |
| `DEVPOST.md` / `TRACKS.md` | Submission text and the per-track requirement audit. |
| `SECURITY.md`, `OPEN_QUESTIONS.md`, `BUILD_LOG.md` | Security surface, decisions and caveats, the chronological log. |

**Tracks we are entering:** Cal Hacks general, Hyphenate (Autonomous Systems for Finance), Microsoft (Built for the Real World), Convex (Best use of Convex), Capital One (Best use of Nessie). **Conditional:** Cartesia (only if we record a real call today) and Apify (only if we add a real vendor domain and a token). Anthropic is optional.

## 5. Rules of the repo (non-negotiable until Sunday)

1. **Frozen core.** These files do not change: `web/convex/guard.ts, cases.ts, payments.ts, probes.ts, confirmations.ts, bankAccounts.ts, contacts.ts, timers.ts, clock.ts, events.ts, crypto.ts, schema.ts`. If you believe one has a bug, write a failing test first and tell Ishant. Only a `core-fix:` commit touches them.
2. **Additive.** New behavior is a new file, route, or flag. Do not change the shape of queries pages already use; add a query.
3. **The gate before every commit.** `bash scripts/verify.sh` (tests, eval, build) must be green. Red means revert, never edit a scenario expectation to pass.
4. **Secrets.** `web/.env.local` is not in git and never will be. Probe amounts never leave the server. Account numbers never reach the browser. Nothing secret in logs or commits. Share keys by direct message only.
5. **Production is a known-good demo.** Only Ishant deploys. Work on a branch, open a PR, Ishant merges and redeploys after the gate and the prod smoke test. Do not run Judge mode or the eval against production while someone is rehearsing on it (both re-seed the database).
6. **Never dial a phone number** that is not in `TEST_PHONE_NUMBERS` (your own phones). Try `VAPI_DRY_RUN=1` first.
7. One feature, one commit, plain commit messages. Append a line to `BUILD_LOG.md` for anything a future reader would wonder about.

## 6. Get running in 15 minutes

Prereqs: Node 20+, Python 3.11+, git, a GitHub account. The repo is public: fork it, clone your fork, and open pull requests from it (send Ishant your GitHub username and he can add you as a collaborator later so you can push branches directly).

```bash
gh repo fork i-shantt/landed --clone && cd landed      # or Fork on GitHub, then git clone <your fork>
git remote add upstream https://github.com/i-shantt/landed.git
cd web && npm ci
cp ../.env.example .env.local          # then paste the values Ishant sends you by DM
npx convex dev                          # terminal 1: creates a local Convex deployment, writes CONVEX_DEPLOYMENT / NEXT_PUBLIC_CONVEX_URL into .env.local
node scripts/sync-env.mjs               # once: mirrors ANTHROPIC_API_KEY, EVAL_KEY, HMAC/ENC keys, EVAL_PROBE_AMOUNT_ENDPOINT=1 into that deployment
npm run dev                             # terminal 2 → http://localhost:3000
```

Then in the app: Settings → **Re-seed fixtures** gives the demo state (three demo cases plus CleanCo's open $42,000 invoice). Keys you need from Ishant: `ANTHROPIC_API_KEY`, `EVAL_KEY`, `ACCOUNT_HMAC_KEY`, `ACCOUNT_ENC_KEY`, and `NESSIE_KEY` if you touch the Capital One rail. Set `EVAL_PROBE_AMOUNT_ENDPOINT=1` locally (it is what lets the eval read the probe amount; prod has it off on purpose).

Tests and the eval:

```bash
cd web && npx vitest run                                      # about 20 s
cd ../eval && python3 -m venv .venv && .venv/bin/pip install httpx pyyaml
.venv/bin/python runner.py --key <EVAL_KEY>                   # against your local deployment
cd .. && bash scripts/verify.sh                               # the full gate
```

Chrome is the demo browser. The app is laid out for 1440×900 and up.

## 7. Today: who does what

Three people, roughly ten working hours, one deadline. The split keeps one person on the story, one on engineering risk, and Ishant on integration and the final call on everything.

### Teammate A — pitch, video, Devpost (the story owner)

1. **Learn the demo cold (9:00 to 11:00).** Open `DEMO.md`, follow the 2:00 script on https://landed-blue.vercel.app five times until it is under two minutes with no hunting for buttons. Then do the 0:60 version. Write down every place you hesitated; that is a UI bug, give the list to Teammate B.
2. **Record the narrated video (11:00 to 14:00, hard stop 15 min on encoding problems).** Easiest path on a Mac: QuickTime → New Screen Recording with the microphone on, Chrome at 1440×900, read `assets/video/NARRATION.md` while clicking through the fraud demo case (`Play with captions` on the case page auto-plays the timeline). Target 2:00 to 2:30, under 3:00. Export `.mp4` and save it as `assets/video/landed-demo.mp4`. Upload to YouTube unlisted (Devpost needs a link). Do not spend time on editing software.
3. **Devpost draft (14:00 to 17:00).** Create the submission on the Cal Hacks 13.0 Devpost. Paste `DEVPOST.md` section by section, add the six screenshots from `assets/screenshots/`, the video link, and the repo link (Ishant flips it public first). Fill in every track checkbox listed under "Tracks" above. Do not change the sourced numbers in the Problem section (IC3, AFP); do update our own numbers if they drift (tests, scenarios, runs). Save as draft; Ishant submits.
4. **Find one AP practitioner (any time you are near sponsor booths).** A controller, AP lead, or anyone who has paid a vendor invoice at work. Ask three questions: how do you verify a bank change today, how often does it get skipped, would a held payment run be acceptable. Put a two-sentence quote with first name and role in `DEVPOST.md` → Problem and tell the team.
5. **Judge Q&A drill (evening).** Read `JUDGE_QA.md`, then quiz Ishant and Teammate B out loud for 20 minutes. Add any question we could not answer to the file with the best answer we agree on.
6. **Pitch timing sheet.** Print or keep open the 2:00 table from `DEMO.md`; mark who speaks which line on Sunday.

### Teammate B — engineering risk, the live call, breaking things (the reliability owner)

1. **Local environment and a backup demo machine (9:00 to 10:00).** Get section 6 working on your laptop. Your laptop is the fallback if the venue Wi-Fi dies: a local Convex deployment plus `npm run dev` runs the whole demo offline except the Claude extractor (switch Extractor to `rules` in Settings for that case). Confirm you can run the fraud demo end to end locally.
2. **Cartesia/Vapi live call (10:00 to 13:00, time-box 3 hours, this decides the Cartesia track).** Steps are in `STATUS.md` → Morning items → item 3 and `README.md` → "Voice (Cartesia via Vapi)". Create a Vapi account, buy or import a number, pick a Cartesia voice, put your own cell in `TEST_PHONE_NUMBERS`. Run with `VAPI_DRY_RUN=1` first and check the `voice_dry_run` event on the case page (it shows the exact request and confirms the assistant never contains the probe amount). Then one real call on your local deployment: the assistant calls you, you read back the amount from the portal, the case goes to verified. **Record the call with your phone's screen recorder or a second phone.** If it works, tell Ishant so he can set the keys on prod and flip Voice to `vapi` for the demo; update `TRACKS.md` → Cartesia from "gap" to met with the recording path. If after three hours it does not dial, stop, write what you learned in `OPEN_QUESTIONS.md`, and we do not enter the track.
3. **Break-it session (13:00 to 15:00).** Try to get money to an unverified account through every UI path: vendor edit then Pay, payment run, the portal with a wrong amount five times, an `.eml` with a lookalike domain, a case with bank and phone changed together, Reject change then Pay, two tabs racing. Every refusal should be plain English plus an enum token. Log each finding with the exact steps in a new file `web/QA_FINDINGS.md`. Fix only what is small and outside the frozen core; everything else goes to Ishant with a failing test if you can write one.
4. **Projector and browser check (15:00 to 16:00).** Chrome at 1280×720 and 1920×1080, Safari once, and 125% zoom. Anything clipped or scrolling horizontally is a bug for the list. Check that the judge laptop can reach `https://landed-blue.vercel.app/health` and that the portal login works on a phone (that is the vendor's side in the demo).
5. **Apify (only if item 2 finished early).** Decide with Ishant whether to enter. If yes: add one real vendor domain to `fixtures/vendors.json`, regenerate (`python3 fixtures/generate.py`), set `APIFY_TOKEN`, and try "Discover from website" on that vendor. If it is not working in one hour, drop it.
6. **Soak before bed.** `cd web && node scripts/soak.mjs --prod --runs 20` (it reseeds prod to the clean demo state when done). Paste the median time to case into `STATUS.md`.

### Ishant — integration, deploys, final calls

1. Repo is already public. Add teammates as collaborators once you have their usernames (`gh repo add-collaborator i-shantt/landed <username>`), so they can push branches instead of forking.
2. Review and merge PRs; redeploy only after `bash scripts/verify.sh` and `node scripts/checkpoint2.mjs --prod`, then `node scripts/prod-seed.mjs`. Rollback ids are at the top of `STATUS.md`.
3. Update `README.md` → Measured and `DEVPOST.md` → "How we know" to the current numbers (106 tests, 28 scenarios, 40 runs). Those are ours to change; the IC3 and AFP figures are not.
4. Decide Cartesia and Apify by 14:00 based on Teammate B's reports.
5. Submit Devpost: draft by 23:30 tonight, final by Sunday 8:30.
6. Own the live demo laptop on Sunday; Teammate B's laptop is the backup.

## 8. Timeline and check-ins

| When | What |
|---|---|
| 9:30 | Both teammates have the app running locally and have watched the 2:00 demo once. |
| 12:00 | Stand-up, 10 minutes: video progress, dial-or-not status, first break-it findings. |
| 14:00 | Cartesia and Apify go/no-go. |
| 17:00 | Video uploaded, Devpost draft complete except the final numbers. |
| 20:00 | Full dress rehearsal on production, phone in hand for the portal. Then Q&A drill. |
| 23:30 | Devpost draft saved. Prod reseeded clean. Everyone sleeps. |
| Sun 8:00 | Final verify, final reseed, repo public, Devpost final by 8:30. Deadline 9:00. Judging 10:30. |

## 9. How we work together today

- Work on your fork (or a branch `<yourname>/<thing>` once you are a collaborator), PR into `i-shantt/landed` `main`, one feature per PR, gate green before you push. Pull `upstream main` before you start each item.
- Say in the group chat when you start and finish each item above, one line each.
- If you are stuck for more than 20 minutes, ask. If a fix needs a frozen file, stop and ask.
- Everything you learn that a future reader would need goes into the matching doc, not just chat.
