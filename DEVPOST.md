# Devpost submission — Landed

**Title:** Landed

**Tagline (under 60 chars):** No payment to an account the vendor hasn't confirmed.

---

## Problem

Companies pay vendors to whatever bank account sits in the vendor record. Business email compromise works by getting that one field changed: a fraudster writes to accounts payable from a compromised or lookalike vendor address and says "we switched banks." The invoice is real, the vendor is real, only the destination changed. FBI IC3 reported $3.05 billion in BEC losses across 24,768 complaints in 2025; the 2026 AFP survey found 74% of organizations were hit, up from 63%, and 39% received genuine emails that had been intercepted. Recovery odds are best within 24 hours and collapse after 72; wires are irrevocable, and under Nacha rules the receiving bank may return a fraudulent ACH credit but is never required to.

The people who live this are the two-person accounts-payable teams at 50-to-500-employee companies whose vendors are too small to appear in bank-verification networks. Their only real control is a phone call that gets skipped when the payment run is due.

## What it does

Landed is a payment-control system. No payment can be sent to a bank account that has not been verified for that specific vendor, even when the AI misses the email, and even when a clerk types the attacker's account in by hand. Verification is a transaction challenge: Landed sends a randomized sub-dollar probe deposit to the new account and asks the vendor's contact of record (a phone number established at onboarding, never a contact from the request) what amount arrived. Only a number match, bound to that exact case, vendor, account, probe, and contact, flips the account to verified. After payment, Landed confirms the money landed; if it did not, it assembles the bank-recall and FBI IC3 response package in minutes.

Fills the payment-verification clerk seat and the first hour of the fraud-response coordinator seat; a human still releases money.

## How it works

**The probe.** A bank-change request (from email intake or a manual edit) creates a new, unverified account version, opens a case, and re-points the vendor's open invoices to the requested account, which is now blocked. A randomized 11 to 99 cent credit with memo `ACCTVERIFY` (the Nacha Micro-Entry pattern) is queued for the next Same Day ACH window and becomes available to the vendor at 13:30, 17:00 or 18:00 receiver-local time. The amount lives in one table and one comparison; it never appears in a prompt, a tool, an event, or a public query.

**The release gate.** A stated amount only counts if it arrives through the voice channel to the number of record or through the vendor portal login. Email statements are stored and marked ignored. The gate checks, in order, case, vendor, account hash, account version, probe, probe availability, exact amount, contact still of record, acceptance, single use, and expiry, then flips the account, consumes the confirmation, transitions the case and logs, all in one database transaction. Wrong amount or "nothing arrived" escalates to a human. The payment function is the only writer of payments and refuses any destination that is missing, another vendor's, unverified, disputed, superseded, or a stale version.

**The landing check.** After Pay, Landed asks the contact of record for the full amount that arrived. A match closes the case as landed. A missed deadline marks the payment unconfirmed and moves the case to recovery.

**The package.** Deterministic fields (trace, amounts, accounts, timeline, FBI Kill Chain eligibility) feed a bank fraud-line script, an indemnification letter draft, an IC3 narrative, an evidence checklist and an insurer notice. Claude drafts the prose when keyed; every number in it is checked against the fields, and templates are the fallback.

## What's real vs. simulated

Real: the Convex engine and the eight invariants (serializable mutations make the release gate and idempotency atomic); versioned accounts with HMAC hashing and AES-256-GCM encryption; the append-only redacted audit log; the rules extractor; the Claude extractor with PDFs passed as documents; the vendor portal login; the eval harness; Nessie transfers on the mock bank (deposit plus withdrawal, integer cents).
Simulated: settlement timing (a demo clock drives ACH windows, availability, SLAs and landing deadlines), vendor answers (the eval harness or a human types what the vendor sees; the Vapi/Cartesia voice channel is written but was not dialed), email authentication results (seeded), and the vendor's bank statement. Every simulation is labeled on screen.

How we know: <!-- measured:start -->213 unit and invariant tests (convex-test), a scripted click-through of the dashboard, and an eval of 28 scenarios across compromised inbox, judge-style cases, legitimate change, lookalike sender, misdirection, payment run and recovery, run with the extractor on and off (40 runs): 15/15 fraud and misdirection scenarios blocked before payment, 9/9 blocked with the extractor off, 0 false releases, 5/5 legitimate changes landed with no human action other than Pay.<!-- measured:end --> These are results on scripted cases; they do not establish effectiveness against real-world fraud.

## Prior art and what Landed adds

Trouvé (SteelHacks, September 2026) does hold-by-policy plus an automated call to the number on file with a yes/no transcript judge. Trustpair and Eftsure validate accounts against networks of previously verified vendors, which leaves out the small vendors a mid-market company actually pays. Charted and similar tools detect suspicious change requests but stop at an alert. Landed adds the number-answer challenge instead of a yes/no, the database-enforced release gate bound to vendor and account version, the landing check after payment, the recovery package, and an eval that includes the legitimate path and the extractor-off path.

## Built with

Convex (schema, transactional mutations, actions, scheduler, crons, HTTP actions, file storage, real-time subscriptions, convex-test), Next.js 16 and React, Tailwind and shadcn/ui, Anthropic SDK (claude-sonnet-5-5 for intake extraction and package prose), Capital One Nessie (mock bank rail), Vapi and Cartesia (voice channel, written and untested), Python with httpx and PyYAML (eval harness), vitest.

## Tracks

Hyphenate (Autonomous Systems for Finance), Microsoft (Built for the Real World), Convex (Best use of Convex), Capital One (Best Use of Nessie), Cartesia (conditional on a recorded call), Anthropic (optional).

## What's next

Wire the voice channel to a real test number and record one call; replace SimRail with a payments-API provider formatted as Nacha Micro-Entries; push the hold into the ERP payment run; add a commercial account-validation lookup ahead of the probe; talk to AP practitioners and quote them here.

---

## Screenshots (in `assets/screenshots/`, 1600×1000, taken on production)

- `00-cases-demo-group.png` — `/cases` with the three pre-run demo cases above the live queue.
- `01-fraud-case-needs-human.png` — the compromised-inbox case in NEEDS_HUMAN: attacker email ignored, nothing arrived, Pay refused.
- `02-ai-off-pay-refused.png` — extractor off, clerk-entered account, Pay refused by the server.
- `03-legit-case-landed.png` — the legitimate case: VERIFIED → PAID → LANDED → CLOSED.
- `04-judge-mid-run.png` — `/judge` running a scenario with the live step list.
- `05-permissions.png` — `/about#permissions`, what the agent can and cannot call.

Video: `assets/video/landed-raw.webm` (raw take, 1280×800) with `assets/video/NARRATION.md`; `assets/video/judge-run.webm` (20 s of judge mode). Deck: `/pitch` in the app and `assets/pitch.pdf`.

## Screenshots to take (original list)

1. `/cases/[id]` on the compromised-inbox case in state NEEDS_HUMAN: timeline showing the attacker's email "Ignored: came through the untrusted email channel", the "nothing arrived" statement, and the Pay refusal.
2. `/vendors/[id]` for CleanCo after the AI-off manual edit: new row `probing` v2, edited row `superseded`, invoice `held`, with the case link.
3. `/cases/[id]` on the legitimate case in state CLOSED: VERIFIED → PAID → LANDED in the timeline and the payment card showing `landed`.

## Video structure (under 3 minutes)

- 0:00–0:15 **The moment.** A DMARC-clean "we changed banks" email is on screen; cut to the case page: "Vendor of record saw no deposit" → NEEDS_HUMAN → Pay refused. One sentence: "The email was authentic. The money still did not move."
- 0:15–0:40 The AI-off version: extractor off, clerk types the account, Pay refused by the database.
- 0:40–1:30 The legitimate path: change email, probe, vendor reads back the amount, verified, paid, landed.
- 1:30–2:10 How it works: the probe, the release gate (one transaction), what is real vs. simulated, the eval table.
- 2:10–2:40 The recovery package after Mark fraud; the Hyphenate seat line.
- 2:40–3:00 What's next.
