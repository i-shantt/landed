# TRACKS.md — compliance audit (2026-10-24, run 2)

Status legend: `met` (opened the page or ran the command), `met with caveat`, `gap`. Paths are repo-relative; pages are on the deployed app or `http://localhost:3000`.

## Cal Hacks general

| Requirement | Where | Status | Notes |
|---|---|---|---|
| "Include an image of your project and GitHub repository for any code to be considered." | `DEVPOST.md` lists the three screenshots; repo is this one | met with caveat | Human pushes the repo public and uploads screenshots Saturday. No secrets in git (`.env.local`, `.vercel/` ignored). |
| "All work must be done during the hackathon." | git history starts 2026-10-23 23:5x PT | met | |
| "three minutes to pitch and two minutes for judges to ask questions" / "prepare a two-minute pitch" | `DEMO.md` (A, B are the pitch), `DEVPOST.md` video structure | met with caveat | Live pitch is a human task. |
| "You must have a pre-recorded or live demonstration." | `DEMO.md`; replay mode `?replay=1` works offline; deployed app | met | Video to be recorded Saturday (structure in `DEVPOST.md`). |
| Application: who/what/why | `README.md` → "Who it is for" | met | |
| Intentionality: intuitive experience, first principles | Phase B redesign; `README.md` invariants | met | |
| Functionality: live demo free of major bugs; video | Checkpoint 2 click-through (`BUILD_LOG.md` 01:45), `scripts/verify.sh` green | met with caveat | Video pending. |
| Creativity: stand out from similar work | `README.md` → "Prior art"; `DEVPOST.md` | met | |
| Technical complexity | `README.md` → "Convex usage", invariants, `web/tests/` | met | |

## Hyphenate — Autonomous Systems for Finance

| Requirement | Where | Status | Notes |
|---|---|---|---|
| "Is it real enough? Realistic data, a messy problem, and proof that it works." | `fixtures/` (20 vendors, 62 invoices, 155 thread messages, DMARC results, a real PDF with a footer change); `eval/RESULTS.md`; `/eval` page | met | |
| "Would you hire it? For which seats… limited access, a clean record of its work, and knowing when to ask?" | Seat line in `README.md` and `DEVPOST.md`; permissions table in `README.md` → "What the agent can and cannot do"; in-app on `/about` (Phase C front item); audit timeline on every case; NEEDS_HUMAN paths and SLA expiry | met with caveat | `/about` page is being added tonight (front of Phase C). |
| "Did we see something new?" | `README.md` → "Prior art and what Landed adds" | met | |
| "The moment." | Demo A step 8–9 (`DEMO.md`), video 0:00–0:15 in `DEVPOST.md` | met | |
| "a demo video that opens with their moment" | `DEVPOST.md` video structure | met with caveat | Human records it. |
| "a live demo at judging (we may ask them to try a scenario of our own)" | Mailbox + Settings clock on the deployed app; `/judge` page (Phase C item 1) | met with caveat | `/judge` one-click runner is Phase C item 1. |
| "one line on the seats their system fills" | `README.md`, `DEVPOST.md` | met | |
| "proof it works: what's real, what's simulated, and how they know" | `README.md` → "What is real vs. simulated"; Settings page "What is real vs. simulated"; `DEVPOST.md`; `eval/RESULTS.md` | met | |

## Microsoft — Built for the Real World

| Requirement | Where | Status |
|---|---|---|
| Customer understanding | `README.md` → "Who it is for" (Customer) | met |
| Measurable usefulness | `README.md` → "Measured"; `/eval` | met |
| Path from prototype to production | `README.md` → "Path from prototype to production" | met |
| Responsible design | `README.md` → "Responsible design" | met |
| End to end functionality | Checkpoint 2 (`web/scripts/checkpoint2.mjs`), click-through, deployed app | met |

## Convex — Best use of Convex

| Requirement | Where | Status | Notes |
|---|---|---|---|
| Inventory of features used | `README.md` → "Convex usage" | met | Database, functions, scheduler, crons, HTTP actions, file storage, real-time, convex-test, local + cloud deployments. |
| Search | — | gap (accepted) | `schema.ts` is frozen tonight, so no search index was added; mailbox and timeline search are client-side. Not claimed in the inventory. |

## Capital One — Best Use of Nessie

| Requirement | Where | Status | Notes |
|---|---|---|---|
| Completeness: works against the live API | `web/convex/rails/nessie.ts`; verified on prod 2026-10-24 (deposit `273b7a8d-1d4f-42dd-aa5c-e2ed40b0a91d`, `BUILD_LOG.md`) | met with caveat | Default rail is `sim`; switch in Settings. Probe and payment both route through Nessie when selected; amounts in integer cents (Nessie truncates to integers). |
| Creativity / Complexity | `README.md` → "Nessie" (deposit + withdrawal model, lazy account creation per destination, idempotency) | met | |
| How to view the transfers | `README.md` → "Nessie" | met | |

## Cartesia — Best Use of Cartesia (conditional)

| Requirement | Where | Status | Notes |
|---|---|---|---|
| Working demo of the voice flow | — | gap | No `VAPI_API_KEY`/`CARTESIA_VOICE_ID`; nothing dialed. Enter only if a call is recorded Saturday. |
| README: setup, Cartesia features used, known limitations | `README.md` → "Voice (Cartesia via Vapi)" | met | |
| No API keys in the repo | `.gitignore`, `.env.example` names only | met | |
| Use of Cartesia meaningfully integrated; privacy/responsible use | `web/convex/channels/vapi.ts` (voice provider cartesia; no amount in the assistant; TEST_PHONE_NUMBERS gate; leak check; transcript stored) | met with caveat | Unverified live. |
| Edge cases: voicemail, wrong person, attempts exhausted | `channels/vapiWebhook.ts`, `confirmations.ts` (no_answer), portal attempts | met | |

## Apify — Best use of Apify

| Requirement | Where | Status | Notes |
|---|---|---|---|
| "Project must be using Apify in a meaningful way." | `web/convex/discovery.ts` (written), vendor page button | gap | No `APIFY_TOKEN`; `.example` fixture domains are not crawlable. Team decides Saturday: add a real vendor domain and run it once, or drop the track. Not claimed in `DEVPOST.md`. |

## Anthropic (optional)

| Requirement | Where | Status | Notes |
|---|---|---|---|
| A named community | `README.md` → "Who it is for" (Community) | met | |
| A real problem (lived or talked to someone) | — | gap (human) | Talk to one AP practitioner Saturday (a sponsor-booth finance person counts) and quote them in `DEVPOST.md`. |
| It works | Checkpoint 2, deployed app | met | |
| Thoughtful use of Claude; where it could go wrong | `README.md` → "Responsible design" (Where Claude could go wrong); intake extraction from threads and PDFs; package prose with grounding check | met | |

## For the morning (human-only items)

- Push the repo public; upload the three screenshots; record the video (structure in `DEVPOST.md`).
- Decide on Cartesia (needs a recorded call) and Apify (needs a real domain + token).
- Talk to one AP practitioner and add a quote to `DEVPOST.md`.
