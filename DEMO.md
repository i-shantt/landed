# DEMO.md — click-by-click

Two terminals: `cd web && npx convex dev` and `cd web && npm run dev`. Open http://localhost:3000. The top banner reads "Prototype. Bank, time, and vendor responses are simulated unless the settings page says otherwise." The header shows the **demo clock**.

Before the demo: **Settings → Re-seed fixtures → confirm**. This wipes all tables and reloads 20 vendors. Set **Extractor** to `claude` (if the key is on the deployment) or `rules`.

Demo vendor: **CleanCo Facilities** (`cleanco.example`), one verified account, open invoice **CC-2026-0412 for $42,000.00** due in 6 days, phone of record `+1 555 010 0000`, portal login `cleanco` / `landed-demo`.

Time: every wait is a button. Settings has **+1h**, **+1 business day**, **Jump to next ACH window** and **Jump to availability** (both advance to the next pending timer; press again for the one after). The clock jump fires the due timers immediately; the timeline fills in as if the bank had settled the probe.

---

## (A) Compromised inbox → held → probe → "nothing arrived" → NEEDS_HUMAN; attacker's email ignored

1. **Mailbox**. Vendor: *CleanCo Facilities*. From: *Vendor's real address* (`ap@cleanco.example`, DMARC pass). Template: *Bank change request* (routing 011000015, account 900012345678). **Send**.
   - Below the form the message appears with intake status `done`, `changed: true`, outcome `case_opened`, and a case link.
2. Click the case link (or **Cases**). The row shows **CleanCo Facilities · PROBE_SENT · $42,000.00 at stake**.
3. **Case page**. Header: vendor, state badge, trigger `instruction_change`, "Validation provider: no coverage → probe." Timeline (newest last): *Case opened* (new account ending 5678 v1, old account ending …), *Invoices held* (CC-2026-0412 now remits to the requested account), *Validation provider: no coverage*, *Probe submitted* (memo ACCTVERIFY; expected settle / availability times; **no amount anywhere**), *Probe accepted by rail*.
   - Probe card: `submitted`, with times. No amount.
   - Say: "The $42,000 invoice is now pointed at the requested account and held. Nothing can be paid to it."
4. **Pay** (select CC-2026-0412) → red alert: **Payment refused by the server · Refused: destination_not_verified**. Timeline gains *Payment refused*.
5. **Settings → Jump to next ACH window**, then **Jump to availability**. Back on the case: state **AWAITING_CONFIRMATION**; timeline adds *Probe settled*, *Probe available*, *Awaiting confirmation*, *Portal confirmation opened*, *Simulated call placed to the phone of record*, *Waiting for a vendor answer*.
6. **Mailbox** again. Same vendor, same real address. Template: *We received your deposit* ("We can confirm receipt of your $0.37 test deposit today…"). **Send**.
7. **Case page → Confirmations card**: a row with channel **email**, badge **Ignored**, reason "Ignored: came through the untrusted email channel". Timeline: *Confirmation received (email, not accepted)*, *Release refused: confirmation_not_accepted*. State still AWAITING_CONFIRMATION; account still `probing`.
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
3. **Settings → Jump to next ACH window**, then **Jump to availability** → case **AWAITING_CONFIRMATION**.
4. Case page, **Simulated vendor answer**: *An amount*, type the probe amount in dollars (e.g. `0.37`). Where does the operator get it? From the SimRail ledger in the Convex dashboard (`simLedger` table) or `GET /eval/probeAmount/{caseId}` with the eval key — it is the one number that is secret from the UI, and the vendor reads it off their statement. **Submit simulated answer**.
   - State → **VERIFIED**. Timeline: *Confirmation received (sim_voice, accepted)*, *Account verified* (channel sim_voice, contact phone), *Old account superseded*. Vendor page: new account `verified` v1, old `superseded`; invoice CC-2026-0412 back to `open`.
5. **Pay** → green **Payment accepted · Payment sent · id …**. State **PAID**; payment card shows ACH, pending landing, landing deadline (end of business day).
6. **Settings → Jump to next ACH window** (the next pending timer is now the landing check, +2h). Timeline: *Simulated call placed (landing)*, *Waiting for a vendor answer*.
7. **Simulated vendor answer** (now reads "The case is PAID: state the full amount that landed"): amount `42000.00` → Submit. Timeline: *Landing statement received*, *Payment landed*, *Case landed*, *Case closed*. State **CLOSED** (via LANDED).

## (D) Recovery package

1. Any case not yet closed (e.g. NorthPeak after a bank-change email): **Mark fraud** → reason ≥ a sentence → **Mark fraud**.
2. State → **RECOVERY**, account `disputed`. Button **Recovery package →** appears.
3. `/cases/[id]/package`: banner "Prepared response package. A human reviews, signs, and makes the call. Recovery is never guaranteed." Sections with **Copy** buttons: Bank fraud-line script, Indemnification letter draft, IC3 narrative, Evidence preservation checklist, Insurer notice, Timeline. Eligibility block: international / ≥ $50,000 / within 72h / Kill Chain criteria met, with the FBI note. Prose is templated from deterministic fields (Claude prose is used only when every number in it also appears in the fields).
   - If a payment had been sent and the landing deadline passed without the vendor confirming, the same package is generated automatically (PAID → UNCONFIRMED → RECOVERY).

## (E) Replay mode (offline fallback)

1. Open any closed case and append `?replay=1` to the URL.
2. The page reads the events once, shows a **Replay** badge, and plays the timeline rows one by one at 10x (the **Replay timeline** button on any case page does the same). No live subscription is used after the first read, so it works if the deployment goes away mid-demo.

## Portal path (optional, instead of the simulated call)

Settings → **Portal demo: open as vendor** opens `/portal/login` in a second tab. Log in `cleanco` / `landed-demo`. `/portal` lists the open confirmation request for the account ending in the new last four. Click it → "Enter the exact amount Meridian Outdoor Co. deposited to your account ending ... today." Three attempts; a wrong amount from the contact of record escalates the case to NEEDS_HUMAN; the right amount verifies it. The token is never emailed and never shown in the AP dashboard.
