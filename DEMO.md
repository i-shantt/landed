# DEMO.md — click-by-click (redesigned UI, run 2)

**Deployed:** https://landed-blue.vercel.app (backend: Convex production). Locally: `cd web && npx convex dev` and `cd web && npm run dev`, then http://localhost:3000.

Layout: left sidebar (Cases, Vendors, Mailbox, Eval, Judge, About, Settings; collapses to a menu on narrow screens), top bar with the company name, the mode chips (extractor / rail / voice) and the **clock chip** (monospace demo time). Clicking the clock chip opens the clock controls: **+1 hour**, **+1 business day**, **Jump to next ACH window** (fires the next probe settlement) and **Jump to availability** (fires the next funds-available timer). The same controls are on Settings. A slim strip reads "Prototype: simulated bank, time, and vendor responses unless Settings says otherwise."

Before the demo: **Settings → Re-seed fixtures → confirm** (on the deployed app this is also `cd web && node scripts/prod-seed.mjs`). Extractor: `claude` if the key is on the deployment, else `rules`.

How holds work (say this once): a bank-change request re-points the vendor's open invoices to the requested account, which is blocked until it is verified or a human rejects the change. Intake can re-point an invoice but can never make an account payable.

Demo vendor: **CleanCo Facilities** (`cleanco.example`), one verified account, open invoice **CC-2026-0412 for $42,000.00**, phone of record `+1 555 010 0000`, portal login `cleanco` / `landed-demo`.

**Fastest path for a judge:** **Judge** in the sidebar → pick `custom_change_in_thread` (or any of the 20 eval scenarios) → **Run**. It re-seeds, runs every step, streams the step list and the case timeline live, and ends with PASS/FAIL. Tick **AI off** to run the same scenario with the extractor disabled (the email is replaced by a clerk's manual edit). The pages below are the same flow by hand.

**For the video:** open any closed case and click **Play with captions** (or add `?autoplay=1`). The timeline plays one event every 2.4 s with a caption pill; Pause / Prev / Next are available; reduced-motion users step manually.

---

## (A) Compromised inbox → held → probe → "nothing arrived" → NEEDS_HUMAN; attacker's email ignored

1. **Mailbox** (two panes: threads left, composer right). Vendor: *CleanCo Facilities* (default). From: *Vendor's real address* (`ap@cleanco.example`, DMARC pass). Template: *Bank change request* (routing 011000015, account 900012345678). **Send to AP**.
   - The thread appears in the left pane with auth chips (SPF/DKIM/DMARC pass), intake `done`, outcome "case opened", and a case link.
2. Click the case link (or **Cases**). The stat cards show 1 open case and **$42,000.00 blocked**; the row shows **CleanCo Facilities · Probe sent · $42,000.00**.
3. **Case page** (two columns: timeline left, cards and actions right). Header: vendor, state badge, trigger, a one-sentence summary of where the case stands, buttons **Replay timeline**, **Play with captions**, **Export**. Timeline grouped by day, newest last: *Case opened* (new account ending 5678 v1, old account ending …), *Invoices held* (CC-2026-0412 now remits to the requested account), *Validation provider: no coverage*, *Probe submitted* (memo ACCTVERIFY; expected settle / availability times; **no amount anywhere**), *Probe accepted by rail*.
   - Right rail: Probe card (`submitted`, "amount withheld"), Accounts (requested vs prior), Confirmations (none yet), **Explain this decision** (three grounded sentences from the events), Actions.
   - Say: "The $42,000 invoice is now pointed at the requested account and held. Nothing can be paid to it."
4. **Pay** (select CC-2026-0412) → red alert: **Payment refused by the server · Refused: destination_not_verified**. Timeline gains *Payment refused*.
5. Click the **clock chip** (top right) → **Jump to next ACH window**, then **Jump to availability**. The case page updates live: state **Awaiting confirmation**, SLA countdown in the header; timeline adds *Probe settled*, *Probe available*, *Awaiting confirmation*, *Portal confirmation opened*, *Simulated call placed to the phone of record*, *Waiting for a vendor answer*.
6. **Mailbox** again. Same vendor, same real address. Template: *We received your deposit* ("We can confirm receipt of your $0.37 test deposit today…"). **Send**.
7. **Case page → Confirmations card**: a row with channel **email**, **not accepted**, "Ignored: came through the untrusted email channel". Timeline: *Confirmation received (email, not accepted)*, *Release refused: confirmation_not_accepted*. State still AWAITING_CONFIRMATION; account still `probing`.
   - Say: "Even if the attacker guessed the amount, email cannot confirm. Only the phone of record or the portal login can."
8. **Simulated vendor answer** card (amber, labeled "A human typing what the vendor sees"): choose **Nothing arrived** → **Submit simulated answer**.
9. State → **NEEDS_HUMAN**, reason `vendor_reports_nothing_arrived`. Timeline: *Confirmation received (sim_voice, accepted)*, *Release refused: amount_mismatch*, *Escalated*. **Pay** again → refused `destination_not_verified`.
10. Human disposition: **Reject change** (reason dialog). Account → `rejected`, invoice CC-2026-0412 returns to the verified account, case → CLOSED. Or **Mark fraud** to see (D).

## (B) AI off → clerk fooled → manual edit → Pay refused

1. **Settings → Extractor → off**.
2. **Mailbox**: send the *Bank change request* from the real address. Below: intake `done`, `mode: off`, `changed: false`. The AI saw nothing.
3. **Vendors → CleanCo Facilities**. Bank accounts table: one verified row. Click **Edit bank account** on it. Dialog "Edit bank account (…last4)": Routing `011000015`, Account `900012345678` → **Save new account**.
   - Table now shows the new row **unverified/probing**, the edited row **superseded**, and a link to the new case.
4. Open the case. **Pay** → **Payment refused by the server · destination_not_verified**. Timeline shows *Payment refused* with the reason and who clicked.
   - Say: "No AI was involved. A human typed the attacker's account. The database refused anyway."
5. Clean up: **Reject change**.

## (C) Legitimate change → VERIFIED → PAID → LANDED

1. **Settings → Extractor → rules** (or claude).
2. **Mailbox**: real address, Template *Bank change request* but edit the body to routing `031000503`, account `55501234567` (the vendor's real new bank). **Send**. Case opens PROBE_SENT.
3. **Clock chip → Jump to next ACH window**, then **Jump to availability** → case **Awaiting confirmation**.
4. Case page, **Simulated vendor answer**: *An amount*, type the probe amount in dollars (e.g. `0.37`). Where does the operator get it? From the SimRail ledger in the Convex dashboard (`simLedger` table) or `GET /eval/probeAmount/{caseId}` with the eval key — it is the one number that is secret from the UI, and the vendor reads it off their statement. **Submit simulated answer**.
   - State → **VERIFIED**. Timeline: *Confirmation received (sim_voice, accepted)*, *Account verified* (channel sim_voice, contact phone), *Old account superseded*. Vendor page: new account `verified` v1, old `superseded`; invoice CC-2026-0412 back to `open`.
5. **Pay** → green **Payment accepted · Payment sent · id …**. State **PAID**; payment card shows ACH, pending landing, landing deadline (end of business day).
6. **Clock chip → +1 hour** twice (the landing check fires at +2h; the clock controls list the pending timers). Timeline: *Simulated call placed (landing)*, *Waiting for a vendor answer*.
7. **Simulated vendor answer** (now reads "The case is PAID: state the full amount that landed"): amount `42000.00` → Submit. Timeline: *Landing statement received*, *Payment landed*, *Case landed*, *Case closed*. State **CLOSED** (via LANDED).

## (D) Recovery package

1. Any case not yet closed (e.g. NorthPeak after a bank-change email): **Mark fraud** → reason ≥ a sentence → **Mark fraud**.
2. State → **RECOVERY**, account `disputed`. Button **Recovery package →** appears.
3. `/cases/[id]/package`: banner "Prepared response package. A human reviews, signs, and makes the call. Recovery is never guaranteed." Sections with **Copy** buttons: Bank fraud-line script, Indemnification letter draft, IC3 narrative, Evidence preservation checklist, Insurer notice, Timeline. Eligibility block: international / ≥ $50,000 / within 72h / Kill Chain criteria met, with the FBI note. Prose is templated from deterministic fields (Claude prose is used only when every number in it also appears in the fields).
   - If a payment had been sent and the landing deadline passed without the vendor confirming, the same package is generated automatically (PAID → UNCONFIRMED → RECOVERY).

## (E) Replay and autoplay (offline fallback and the video)

1. Open any closed case and click **Replay timeline** (or append `?replay=1`). The page reads the events once, shows a **Replay** badge, and plays the rows one by one at 10x with no live subscription.
2. **Play with captions** (or `?autoplay=1`) does the same with the DEMO.md caption lines overlaid, Pause / Prev / Next, for screen recording.

## (F) Judge mode

**Judge** → choose a scenario → **Run** (optionally **AI off**). Watch the step list and the embedded timeline; open the case link; the run ends PASS/FAIL against the scenario's expectation. The run history also appears on **Eval**.

## (G) About

**About** shows the permissions table (what the agent can and cannot call), what is real vs. simulated, how we know (test and eval counts, link to Eval), the seat line, and the eight invariants. Use it to answer "would you hire it". No live subscription is used after the first read, so it works if the deployment goes away mid-demo.

## Portal path (optional, instead of the simulated call)

Settings → **Portal demo: open as vendor** opens `/portal/login` in a second tab. Log in `cleanco` / `landed-demo`. `/portal` lists the open confirmation request for the account ending in the new last four. Click it → "Enter the exact amount Meridian Outdoor Co. deposited to your account ending ... today." Three attempts; a wrong amount from the contact of record escalates the case to NEEDS_HUMAN; the right amount verifies it. The token is never emailed and never shown in the AP dashboard.
