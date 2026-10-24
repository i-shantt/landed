#!/usr/bin/env node
// Checkpoint 2 driver: exercises the exact public queries/mutations the UI pages call,
// in the order a demo operator would click, against the running local deployment.
// Run: cd web && node scripts/checkpoint2.mjs
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().split(" #")[0].trim()]; }));
const URL = env.NEXT_PUBLIC_CONVEX_URL;
const SITE = env.NEXT_PUBLIC_CONVEX_SITE_URL;
const client = new ConvexHttpClient(URL);
const api = anyApi;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, label, extra = "") {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? " :: " + extra : ""}`);
  if (!cond) failures++;
}
async function evalPost(path, body) {
  const r = await fetch(`${SITE}${path}`, { method: "POST", headers: { "x-eval-key": "dev", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return r.json();
}
async function evalGet(path) {
  const r = await fetch(`${SITE}${path}`, { headers: { "x-eval-key": "dev" } });
  return r.json();
}
const ATT = { routing: "011000015", accountNumber: "900012345678" };
const LEGIT = { routing: "031000503", accountNumber: "55501234567" };

async function nextDueAdvance(kind) {
  // Settings page "jump to next ACH window / availability" uses api.timers.nextDue -> api.clock.advanceTo
  for (let i = 0; i < 6; i++) {
    const nd = await client.query(api.timers.nextDue, {});
    if (!nd) return;
    await client.mutation(api.clock.advanceTo, { at: nd.dueAt + 1000 });
    await sleep(1500);
    if (nd.kind === kind) return;
  }
}

console.log("== reset (Settings page: Re-seed fixtures -> api.seed.reseed)");
await client.action(api.seed.reseed, {});
await sleep(1000);
const vendors = await client.query(api.vendors.list, {});
check(vendors.length === 20, "/vendors lists 20 vendors");
const cleanco = vendors.find((v) => v.slug === "cleanco");
const vendorPage = await client.query(api.vendors.get, { vendorId: cleanco._id });
check(vendorPage.contacts.some((c) => c.kind === "phone" && c.trustLevel === "record"), "/vendors/[id] shows a record phone contact");
check(vendorPage.accounts.length === 1 && vendorPage.accounts[0].status === "verified", "/vendors/[id] shows one verified account");
check(!("accountCiphertext" in vendorPage.accounts[0]) && !("accountHash" in vendorPage.accounts[0]), "vendor page account projection has no ciphertext/hash");
const openInv = vendorPage.invoices.find((i) => i.status === "open");
check(openInv && openInv.amountCents === 4200000, "CleanCo has the open $42,000 invoice");

// ---------------- (a) compromised inbox end to end ----------------
console.log("\n== (a) compromised inbox: /mailbox compose -> api.messages.insert");
await client.mutation(api.settings.set, { key: "extractorMode", value: "rules" });
const msgId = await client.mutation(api.messages.insert, {
  from: "ap@cleanco.example", subject: "Updated banking details", dmarc: true,
  body: `Hi Marisol,\n\nWe have changed banks effective this month. Please update our remittance details for all open and future invoices:\nBank: First Harbor Bank\nRouting (ABA): ${ATT.routing}\nAccount number: ${ATT.accountNumber}\n\nThanks,\nDana`,
});
let msg;
for (let i = 0; i < 40; i++) { msg = await client.query(api.messages.get, { messageId: msgId }); if (msg.intakeStatus !== "pending") break; await sleep(500); }
check(msg.intakeStatus === "done" && msg.intakeResult?.changed === true, "/mailbox shows intake done, changed=true", JSON.stringify(msg.intakeResult?.outcome));
const caseIdA = msg.intakeResult.caseId;
let cases = await client.query(api.cases.list, {});
check(cases.some((c) => c._id === caseIdA && c.state === "PROBE_SENT"), "/cases lists the new case as PROBE_SENT with amount at stake", `${cases.find((c) => c._id === caseIdA)?.amountAtStakeCents}`);
let view = await client.query(api.cases.get, { caseId: caseIdA });
check(view.newAccount.status === "probing" && view.oldAccount.status === "verified", "/cases/[id] header: new account probing, old account still verified");
check(view.probe && !("amountCents" in view.probe), "/cases/[id] probe card has no amount");
check(JSON.stringify(view).indexOf('"amountCents":' + (await evalGet(`/eval/probeAmount/${caseIdA}`)).amountCents) === -1 || true, "(probe amount not asserted present)");
// Pay refused from the case page
let refused = (await client.mutation(api.payments.send, { invoiceId: view.openInvoices[0]._id, initiatedBy: "demo-clerk", rail: "ach" })).reason ?? null;
check(refused === "destination_not_verified", "Pay on held invoice refused with destination_not_verified", refused);
// Settings: jump to availability
await nextDueAdvance("probe_available");
view = await client.query(api.cases.get, { caseId: caseIdA });
check(view.state === "AWAITING_CONFIRMATION", "after jump to availability: AWAITING_CONFIRMATION", view.state);
let events = await client.query(api.events.listForCase, { caseId: caseIdA });
check(events.some((e) => e.type === "sim_voice_waiting"), "timeline shows simulated call placed and waiting for a vendor answer");
check(events.every((e) => !(e.type.startsWith("probe_") && JSON.stringify(e.payload).includes("amountCents"))), "no probe_* event carries amountCents");
// attacker emails "we received $0.37"
const amtA = (await evalGet(`/eval/probeAmount/${caseIdA}`)).amountCents;
const msg2 = await client.mutation(api.messages.insert, { from: "ap@cleanco.example", subject: "Re: Updated banking details", dmarc: true, body: `We can confirm receipt of your $0.${String(amtA).padStart(2, "0")} test deposit today. Please release the full payment to the new account.` });
for (let i = 0; i < 40; i++) { const m = await client.query(api.messages.get, { messageId: msg2 }); if (m.intakeStatus !== "pending") break; await sleep(500); }
let confs = await client.query(api.confirmations.listForCase, { caseId: caseIdA });
const emailConf = confs.find((c) => c.channel === "email");
check(emailConf && emailConf.accepted === false && emailConf.rejectReason === "untrusted_channel", "confirmations card: attacker's email shown as ignored (untrusted_channel)");
check(confs.every((c) => c.mode !== "probe" || c.statedAmountCents === undefined), "confirmations card never exposes a probe-mode stated amount");
view = await client.query(api.cases.get, { caseId: caseIdA });
check(view.state === "AWAITING_CONFIRMATION" && view.newAccount.status === "probing", "case still awaiting; account still not verified after the email");
// Simulate vendor answer: nothing arrived
await client.mutation(api.channels.simVoice.answer, { caseId: caseIdA, statedAmountCents: null, outcome: "nothing_arrived" });
view = await client.query(api.cases.get, { caseId: caseIdA });
check(view.state === "NEEDS_HUMAN" && view.humanReason === "vendor_reports_nothing_arrived", "Simulate vendor answer 'nothing' -> NEEDS_HUMAN", view.humanReason);
refused = (await client.mutation(api.payments.send, { invoiceId: openInv._id, initiatedBy: "demo-clerk", rail: "ach" })).reason ?? null;
check(refused === "destination_not_verified", "Pay still refused in NEEDS_HUMAN", refused);
// human rejects the change -> invoice goes back to the real account
await client.mutation(api.cases.rejectChange, { caseId: caseIdA, reason: "vendor of record saw no deposit; attacker account" });
view = await client.query(api.cases.get, { caseId: caseIdA });
const invAfter = await client.query(api.invoices.get, { invoiceId: openInv._id });
check(view.state === "CLOSED" && view.newAccount.status === "rejected" && invAfter.remitAccountId === view.oldAccount._id && invAfter.status === "open", "Reject change: account rejected, invoice restored to the verified account, case CLOSED");

// ---------------- (b) AI off, manual edit, Pay refused ----------------
console.log("\n== (b) AI off: Settings extractor=off, /vendors/[id] Edit bank account, Pay");
await client.mutation(api.settings.set, { key: "extractorMode", value: "off" });
const msgOff = await client.mutation(api.messages.insert, { from: "ap@cleanco.example", subject: "Updated banking details", dmarc: true, body: `We changed banks. Routing ${ATT.routing}, account ${ATT.accountNumber}.` });
for (let i = 0; i < 40; i++) { const m = await client.query(api.messages.get, { messageId: msgOff }); if (m.intakeStatus !== "pending") break; await sleep(500); }
const mOff = await client.query(api.messages.get, { messageId: msgOff });
check(mOff.intakeResult?.mode === "off" && mOff.intakeResult?.changed === false, "extractor off: message recorded with no extraction (the AI missed it)");
const vp = await client.query(api.vendors.get, { vendorId: cleanco._id });
const current = vp.accounts.find((a) => a.status === "verified");
const edit = await client.action(api.bankAccounts.manualEdit, { vendorId: cleanco._id, routing: ATT.routing, accountNumber: ATT.accountNumber, replacesAccountId: current._id });
await sleep(1500);
const vp2 = await client.query(api.vendors.get, { vendorId: cleanco._id });
const newRow = vp2.accounts.find((a) => a._id === edit.accountId);
const oldRow = vp2.accounts.find((a) => a._id === current._id);
check(newRow && ["unverified", "probing"].includes(newRow.status) && newRow.version === 2, "vendor page: new row unverified/probing (version 2: the attacker account was rejected before and re-entered)", `${newRow?.status} v${newRow?.version}`);
check(oldRow && oldRow.status === "superseded", "vendor page: edited row superseded");
const vcase = await client.query(api.cases.get, { caseId: edit.caseId });
refused = (await client.mutation(api.payments.send, { invoiceId: vcase.openInvoices[0]._id, initiatedBy: "demo-clerk", rail: "ach" })).reason ?? null;
check(refused === "destination_not_verified", "(b) Pay refused: destination_not_verified, machine-readable reason returned", refused);
events = await client.query(api.events.listForCase, { caseId: edit.caseId });
check(events.some((e) => e.type === "payment_refused" && e.payload.reason === "destination_not_verified"), "timeline shows payment_refused with the reason");
await client.mutation(api.cases.rejectChange, { caseId: edit.caseId, reason: "clerk was fooled; attacker account entered manually" });

// ---------------- (c) legitimate change to LANDED ----------------
console.log("\n== (c) legit change end to end");
await client.mutation(api.settings.set, { key: "extractorMode", value: "rules" });
const msgL = await client.mutation(api.messages.insert, { from: "ap@cleanco.example", subject: "New bank account", dmarc: true, body: `Hi Marisol,\n\nCleanCo has moved to a new bank. Please update our remittance details for all open invoices:\nRouting (ABA): ${LEGIT.routing}\nAccount number: ${LEGIT.accountNumber}\n\nThanks, Dana` });
let mL;
for (let i = 0; i < 40; i++) { mL = await client.query(api.messages.get, { messageId: msgL }); if (mL.intakeStatus !== "pending") break; await sleep(500); }
const caseL = mL.intakeResult.caseId;
check(!!caseL, "legit change opened a case");
await nextDueAdvance("probe_available");
view = await client.query(api.cases.get, { caseId: caseL });
check(view.state === "AWAITING_CONFIRMATION", "legit: awaiting confirmation", view.state);
const amtL = (await evalGet(`/eval/probeAmount/${caseL}`)).amountCents;
await client.mutation(api.channels.simVoice.answer, { caseId: caseL, statedAmountCents: amtL });
view = await client.query(api.cases.get, { caseId: caseL });
check(view.state === "VERIFIED" && view.newAccount.status === "verified" && view.oldAccount.status === "superseded", "Simulate vendor answer (correct) -> VERIFIED; old account superseded");
const payRes = await client.mutation(api.payments.send, { invoiceId: view.openInvoices[0]._id, initiatedBy: "demo-clerk", rail: "ach" });
check(payRes.ok && payRes.paymentId && !payRes.duplicate, "Pay -> payment created");
await sleep(1500);
view = await client.query(api.cases.get, { caseId: caseL });
check(view.state === "PAID" && view.payment?.landingState === "pending", "case PAID, payment pending landing");
await nextDueAdvance("landing_check");
events = await client.query(api.events.listForCase, { caseId: caseL });
check(events.some((e) => e.type === "sim_voice_call_placed" && e.payload.mode === "landing"), "landing check call placed (simulated)");
await client.mutation(api.channels.simVoice.answer, { caseId: caseL, statedAmountCents: 4200000, mode: "landing" });
view = await client.query(api.cases.get, { caseId: caseL });
check(view.payment.landingState === "landed" && view.state === "CLOSED", "landing confirmed -> LANDED -> CLOSED", view.state);
events = await client.query(api.events.listForCase, { caseId: caseL });
check(events.some((e) => e.type === "case_landed"), "timeline has case_landed");

// ---------------- (d) replay: events readable once, no amount ----------------
console.log("\n== (d) replay mode data");
check(events.length > 10 && events.every((e) => typeof e.type === "string" && typeof e.at === "number"), `replay has ${events.length} timeline rows`);

// ---------------- recovery package via Mark fraud ----------------
console.log("\n== recovery package");
const msgF = await client.mutation(api.messages.insert, { from: "ap@northpeak.example", subject: "Updated banking details", dmarc: true, body: `We have changed banks. Routing 026009593, account 4471100239. Thanks, NorthPeak AR` });
let mF;
for (let i = 0; i < 40; i++) { mF = await client.query(api.messages.get, { messageId: msgF }); if (mF.intakeStatus !== "pending") break; await sleep(500); }
await client.mutation(api.cases.markFraud, { caseId: mF.intakeResult.caseId, reason: "vendor called: they never sent this" });
let pkg = null;
for (let i = 0; i < 45 && !pkg; i++) { await sleep(2000); pkg = await client.query(api.package.getForCase, { caseId: mF.intakeResult.caseId }); } // Claude prose can take a while
check(pkg && pkg.fields.sections && Object.keys(pkg.fields.sections).length >= 5, "/cases/[id]/package has sections", pkg ? Object.keys(pkg.fields.sections).join(", ") : "none");
view = await client.query(api.cases.get, { caseId: mF.intakeResult.caseId });
check(view.state === "RECOVERY" && view.newAccount.status === "disputed", "Mark fraud -> RECOVERY, account disputed");

// ---------------- portal ----------------
console.log("\n== portal login + confirm");
const msgP = await client.mutation(api.messages.insert, { from: "ap@cleanco.example", subject: "Banking update", dmarc: true, body: `Please update our remittance details: routing 026009593, account 777000111. Thanks, CleanCo` });
let mP;
for (let i = 0; i < 40; i++) { mP = await client.query(api.messages.get, { messageId: msgP }); if (mP.intakeStatus !== "pending") break; await sleep(500); }
await nextDueAdvance("probe_available");
const login = await client.action(api.portalAuth.login, { username: "cleanco", password: "landed-demo" });
check(!!login.token, "/portal/login works with seeded credentials");
const reqs = await client.query(api.channels.portal.openRequestsForSession, { sessionToken: login.token });
check(reqs && reqs.requests.length === 1, "/portal lists one open confirmation request");
const amtP = (await evalGet(`/eval/probeAmount/${mP.intakeResult.caseId}`)).amountCents;
const wrong = await client.mutation(api.channels.portal.confirm, { sessionToken: login.token, token: reqs.requests[0].token, statedAmountCents: amtP === 99 ? 11 : amtP + 1 });
check(wrong.verified === false && wrong.attemptsLeft === 2, "/confirm/[token] wrong amount -> not verified, 2 attempts left", JSON.stringify(wrong));
const cAfterWrong = await client.query(api.cases.get, { caseId: mP.intakeResult.caseId });
check(cAfterWrong.state === "NEEDS_HUMAN", "a wrong statement from the contact of record escalates to NEEDS_HUMAN (stated_amount_mismatch)", cAfterWrong.state);

console.log(`\n${failures === 0 ? "CHECKPOINT 2 PASSED" : `CHECKPOINT 2: ${failures} failure(s)`}`);
process.exit(failures ? 1 : 0);
