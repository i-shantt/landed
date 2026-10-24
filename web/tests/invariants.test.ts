// Section 10.2 invariant tests (convex-test).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { redact } from "../convex/events";
import { setup, manualEdit, pay, advanceToAvailability, vendorStatement, probeAmount, getCase, getAccount, drain, advance, VENDOR_B_ACCOUNT, VENDOR_C_ACCOUNT } from "./harness";

async function awaitingCase(t: Awaited<ReturnType<typeof setup>>["t"], vendorId: Id<"vendors">, acct = VENDOR_B_ACCOUNT, replaces?: Id<"bankAccounts">) {
  const r = await manualEdit(t, vendorId, acct.routing, acct.accountNumber, replaces);
  await advanceToAvailability(t, r.caseId);
  expect((await getCase(t, r.caseId)).state).toBe("AWAITING_CONFIRMATION");
  return r;
}

describe("invariants", () => {
  it("1. extractor off; manual edit -> unverified new version; Pay refused destination_not_verified", async () => {
    const { t, ids } = await setup();
    await t.mutation(api.settings.set, { key: "extractorMode", value: "off" });
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const r = await manualEdit(t, cleanco, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber, ids.accounts.cleanco_main as Id<"bankAccounts">);
    const acct = await getAccount(t, r.accountId);
    expect(acct.status).not.toBe("verified");
    expect(acct.version).toBe(1);
    const res = await pay(t, ids.invoices["CC-2026-0412"] as Id<"invoices">);
    expect(res).toEqual({ ok: false, reason: "destination_not_verified" });
    expect((await t.run(async (ctx) => ctx.db.query("payments").collect())).length).toBe(0);
  });

  it("2. wrong template: invoice remit = another vendor's verified account -> destination_vendor_mismatch", async () => {
    const { t, ids } = await setup();
    const crafted = await t.run(async (ctx) =>
      ctx.db.insert("invoices", { vendorId: ids.vendors.cleanco as Id<"vendors">, number: "X-1", amountCents: 5000, issuedAt: Date.now(), dueAt: Date.now(), remitAccountId: ids.accounts.northpeak_main as Id<"bankAccounts">, status: "open" })
    );
    expect(await pay(t, crafted)).toEqual({ ok: false, reason: "destination_vendor_mismatch" });
  });

  it("3. replayed confirmation from a prior case -> case_mismatch", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const a = await awaitingCase(t, cleanco);
    await vendorStatement(t, a.caseId, await probeAmount(t, a.caseId));
    const ca = await getCase(t, a.caseId);
    expect(ca.state).toBe("VERIFIED");
    const confId = ca.confirmationId!;
    // second case for the same vendor, different account
    const b = await awaitingCase(t, cleanco, VENDOR_C_ACCOUNT);
    // give the replay the same amount as case B's probe so only the binding refuses it
    const amountB = await probeAmount(t, b.caseId);
    await t.run(async (ctx) => ctx.db.patch(confId, { usedAt: undefined, statedAmountCents: amountB }));
    const d = await t.mutation(internal.cases.tryReleaseInternal, { caseId: b.caseId, confirmationId: confId });
    expect(d).toEqual({ ok: false, reason: "case_mismatch" });
    expect((await getCase(t, b.caseId)).state).toBe("AWAITING_CONFIRMATION");
    expect((await getAccount(t, b.accountId)).status).not.toBe("verified");
  });

  it("4. two tryRelease calls: first ok, second confirmation_used; exactly one usedAt", async () => {
    const { t, ids } = await setup();
    const a = await awaitingCase(t, ids.vendors.cleanco as Id<"vendors">);
    const amount = await probeAmount(t, a.caseId);
    // record the confirmation without letting the channel call tryRelease: insert directly
    const contact = await t.run(async (ctx) => (await ctx.db.query("contacts").collect()).find((c) => c.kind === "phone" && c.vendorId === (ids.vendors.cleanco as Id<"vendors">))!);
    const confId = await t.run(async (ctx) => {
      const c = (await ctx.db.get(a.caseId))!;
      const acct = (await ctx.db.get(c.newAccountId))!;
      const clock = (await ctx.db.query("clock").first())!;
      const now = Date.now() + clock.offsetMs;
      return ctx.db.insert("confirmations", { caseId: c._id, vendorId: c.vendorId, accountHash: acct.accountHash, accountVersion: acct.version, probeId: c.probeId, channel: "sim_voice", contactId: contact._id, statedAmountCents: amount, receivedAt: now, expiresAt: now + 7200000, accepted: true });
    });
    const d1 = await t.mutation(internal.cases.tryReleaseInternal, { caseId: a.caseId, confirmationId: confId });
    expect(d1).toEqual({ ok: true });
    const d2 = await t.mutation(internal.cases.tryReleaseInternal, { caseId: a.caseId, confirmationId: confId });
    expect(d2).toEqual({ ok: false, reason: "confirmation_used" });
    const confs = await t.run(async (ctx) => ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).collect());
    expect(confs.filter((c) => c.usedAt !== undefined).length).toBe(1);
  });

  it("5. probes.create twice with the same key -> one row; one simLedger entry", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    await t.mutation(internal.probes.createInternal, { caseId: r.caseId });
    await drain(t);
    await t.mutation(internal.probes.createInternal, { caseId: r.caseId });
    await drain(t);
    const probes = await t.run(async (ctx) => ctx.db.query("probes").withIndex("by_case", (q) => q.eq("caseId", r.caseId)).collect());
    expect(probes.length).toBe(1);
    const ledger = await t.run(async (ctx) => ctx.db.query("simLedger").collect());
    const probeEntries = ledger.flatMap((l) => l.entries).filter((e) => e.memo === "ACCTVERIFY");
    expect(probeEntries.length).toBe(1);
  });

  it("6. contact superseded after the case opened -> contact_superseded; never verified", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const a = await awaitingCase(t, cleanco);
    const contact = await t.run(async (ctx) => (await ctx.db.query("contacts").collect()).find((c) => c.kind === "phone" && c.vendorId === cleanco)!);
    await t.mutation(api.contacts.supersede, { contactId: contact._id, reason: "number ported away" });
    const amount = await probeAmount(t, a.caseId);
    // the channel no longer finds a record phone contact; force the statement through the old contact
    await t.mutation(internal.confirmations.recordFromChannelInternal, { caseId: a.caseId, channel: "sim_voice", contactId: contact._id, statedAmountCents: amount, outcome: "stated" });
    const c = await getCase(t, a.caseId);
    expect(c.state).toBe("AWAITING_CONFIRMATION");
    expect((await getAccount(t, a.accountId)).status).not.toBe("verified");
    const ev = await t.run(async (ctx) => ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).collect());
    const refused = ev.filter((e) => e.type === "release_refused").map((e) => (e.payload as { reason: string }).reason);
    expect(refused).toContain("contact_superseded");
  });

  it("7. account edited while a confirmation is pending -> account_version_mismatch; new version unverified", async () => {
    const { t, ids } = await setup();
    const a = await awaitingCase(t, ids.vendors.cleanco as Id<"vendors">);
    const amount = await probeAmount(t, a.caseId);
    const contact = await t.run(async (ctx) => (await ctx.db.query("contacts").collect()).find((c) => c.kind === "phone")!);
    const confId = await t.run(async (ctx) => {
      const c = (await ctx.db.get(a.caseId))!;
      const acct = (await ctx.db.get(c.newAccountId))!;
      const clock = (await ctx.db.query("clock").first())!;
      const now = Date.now() + clock.offsetMs;
      return ctx.db.insert("confirmations", { caseId: c._id, vendorId: c.vendorId, accountHash: acct.accountHash, accountVersion: acct.version, probeId: c.probeId, channel: "sim_voice", contactId: contact._id, statedAmountCents: amount, receivedAt: now, expiresAt: now + 7200000, accepted: true });
    });
    // Account re-entered after the previous version was retired: version bumps, status unverified.
    await t.run(async (ctx) => ctx.db.patch(a.accountId, { status: "superseded" }));
    const again = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    const v2 = await getAccount(t, again.accountId);
    expect(v2.version).toBe(2);
    expect(["unverified", "probing"]).toContain(v2.status);
    // Point the pending confirmation's case at the new version to show the binding refuses it.
    await t.run(async (ctx) => ctx.db.patch(a.caseId, { newAccountId: again.accountId }));
    const d = await t.mutation(internal.cases.tryReleaseInternal, { caseId: a.caseId, confirmationId: confId });
    expect(d).toEqual({ ok: false, reason: "account_version_mismatch" });
    expect((await getAccount(t, again.accountId)).status).not.toBe("verified");
  });

  it("8. confirmation after settled but before available -> probe_not_available; after available -> ok", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    // advance to the settle timer only
    const timers = await t.run(async (ctx) => ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", r.caseId)).collect());
    const settle = timers.find((x) => x.kind === "probe_settle")!;
    const now = (await t.query(api.clock.get, {})).now;
    await advance(t, settle.dueAt - now + 1000);
    const probe = await t.run(async (ctx) => ctx.db.get((await ctx.db.get(r.caseId))!.probeId!));
    expect(probe!.state).toBe("settled");
    const amount = probe!.amountCents;
    const contact = await t.run(async (ctx) => (await ctx.db.query("contacts").collect()).find((c) => c.kind === "phone" && c.vendorId === (ids.vendors.cleanco as Id<"vendors">))!);
    const res = await t.mutation(internal.confirmations.recordFromChannelInternal, { caseId: r.caseId, channel: "sim_voice", contactId: contact._id, statedAmountCents: amount, outcome: "stated" });
    expect(res.decision).toEqual({ ok: false, reason: "probe_not_available" });
    expect((await getCase(t, r.caseId)).state).toBe("PROBE_SENT");
    await advanceToAvailability(t, r.caseId);
    await vendorStatement(t, r.caseId, amount);
    expect((await getCase(t, r.caseId)).state).toBe("VERIFIED");
  });

  it("9. Pay to a disputed account -> destination_disputed", async () => {
    const { t, ids } = await setup();
    await t.run(async (ctx) => ctx.db.patch(ids.accounts.cleanco_main as Id<"bankAccounts">, { status: "disputed" }));
    expect(await pay(t, ids.invoices["CC-2026-0412"] as Id<"invoices">)).toEqual({ ok: false, reason: "destination_disputed" });
  });

  it("10. static: exactly one `.insert(\"payments\"` under convex/, in payments.ts", () => {
    const root = join(__dirname, "..", "convex");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "_generated") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) {
          const src = readFileSync(p, "utf8");
          const n = src.split('.insert("payments"').length - 1;
          for (let i = 0; i < n; i++) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits.length).toBe(1);
    expect(hits[0].endsWith("payments.ts")).toBe(true);
  });

  it("11. redaction: probe_* events drop amountCents and account numbers", () => {
    const out = redact("probe_submitted", { probeId: "p1", amountCents: 37, nested: { amountCents: 37, accountNumber: "123456789" }, memo: "ACCTVERIFY" }) as Record<string, unknown>;
    expect(out).toEqual({ probeId: "p1", nested: {}, memo: "ACCTVERIFY" });
    const keep = redact("payment_sent", { amountCents: 4200000, accountNumberPlain: "1", accountCiphertext: "x" }) as Record<string, unknown>;
    expect(keep).toEqual({ amountCents: 4200000 });
  });

  it("12. probes.getPublic has no amountCents; case view has no amount", async () => {
    const { t, ids } = await setup();
    const r = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    const pub = await t.query(api.probes.getPublic, { caseId: r.caseId });
    expect(pub).not.toBeNull();
    expect(Object.keys(pub!)).not.toContain("amountCents");
    const view = await t.query(api.cases.get, { caseId: r.caseId });
    expect(JSON.stringify(view)).not.toMatch(/"amountCents":\s*(1[1-9]|[2-9]\d)\b/);
    const ev = await t.query(api.events.listForCase, { caseId: r.caseId });
    for (const e of ev) if (e.type.startsWith("probe_")) expect(JSON.stringify(e.payload)).not.toContain("amountCents");
  });

  it("I4. email-channel statement is stored rejected and never releases", async () => {
    const { t, ids } = await setup();
    const a = await awaitingCase(t, ids.vendors.cleanco as Id<"vendors">);
    const amount = await probeAmount(t, a.caseId);
    const msgId = await t.run(async (ctx) => ctx.db.insert("messages", { threadId: "x", from: "ap@cleanco.example", to: "ap@meridianoutdoor.example", subject: "re", body: `We received $0.${String(amount).padStart(2, "0")}`, sentAt: Date.now(), channel: "email", authResult: { spf: true, dkim: true, dmarc: true }, attachmentStorageIds: [], intakeStatus: "done" }));
    await t.mutation(internal.messages.recordReceiptClaim, { messageId: msgId, caseId: a.caseId, statedAmountCents: amount });
    const confs = await t.run(async (ctx) => ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).collect());
    expect(confs.length).toBe(1);
    expect(confs[0].accepted).toBe(false);
    expect(confs[0].rejectReason).toBe("untrusted_channel");
    expect((await getCase(t, a.caseId)).state).toBe("AWAITING_CONFIRMATION");
    expect((await getAccount(t, a.accountId)).status).not.toBe("verified");
  });

  it("I2/dedupe: the same new account entered twice reuses the open case", async () => {
    const { t, ids } = await setup();
    const a = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    const b = await manualEdit(t, ids.vendors.cleanco as Id<"vendors">, VENDOR_B_ACCOUNT.routing, VENDOR_B_ACCOUNT.accountNumber);
    expect(b.reused).toBe(true);
    expect(b.caseId).toBe(a.caseId);
  });

  it("exceptionalRelease needs two distinct approvers and a 20+ char reason; works only from NEEDS_HUMAN", async () => {
    const { t, ids } = await setup();
    const a = await awaitingCase(t, ids.vendors.cleanco as Id<"vendors">);
    await expect(t.mutation(api.cases.exceptionalRelease, { caseId: a.caseId, approverA: "Ana", approverB: "Ben", reason: "this reason is definitely long enough" })).rejects.toThrow();
    await t.mutation(api.cases.requestHumanReview, { caseId: a.caseId, reason: "manual" });
    await expect(t.mutation(api.cases.exceptionalRelease, { caseId: a.caseId, approverA: "Ana", approverB: "ana", reason: "this reason is definitely long enough" })).rejects.toThrow();
    await expect(t.mutation(api.cases.exceptionalRelease, { caseId: a.caseId, approverA: "Ana", approverB: "Ben", reason: "short" })).rejects.toThrow();
    await t.mutation(api.cases.exceptionalRelease, { caseId: a.caseId, approverA: "Ana", approverB: "Ben", reason: "vendor CFO confirmed on a recorded call with treasury" });
    expect((await getCase(t, a.caseId)).state).toBe("VERIFIED");
    expect((await getAccount(t, a.accountId)).status).toBe("verified");
  });

  it("SLA: no statement within 24h of availability -> NEEDS_HUMAN sla_expired", async () => {
    const { t, ids } = await setup();
    const a = await awaitingCase(t, ids.vendors.cleanco as Id<"vendors">);
    await advance(t, 25 * 3600_000);
    const c = await getCase(t, a.caseId);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(c.humanReason).toBe("sla_expired");
  });

  it("contact change in the same request -> NEEDS_HUMAN with no probe", async () => {
    const { t, ids } = await setup();
    const res = await t.action(internal.bankAccounts.createUnverified, { vendorId: ids.vendors.cleanco as Id<"vendors">, routing: VENDOR_B_ACCOUNT.routing, accountNumberPlain: VENDOR_B_ACCOUNT.accountNumber, createdVia: "intake", contactAlsoChanged: true });
    await drain(t);
    const c = await getCase(t, res.caseId!);
    expect(c.state).toBe("NEEDS_HUMAN");
    expect(c.humanReason).toBe("contact_and_bank_changed_together");
    expect(c.probeId).toBeUndefined();
  });
});
