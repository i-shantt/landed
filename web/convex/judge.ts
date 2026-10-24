// Judge mode: run an eval scenario from the dashboard. The action executes the same
// steps as eval/runner.py against this deployment using internal functions, and streams
// progress into an `evalRuns` row (scenarioId "judge:<runId>") that the /judge page
// subscribes to. Flag: settings.judgeMode ("off" disables). Additive: touches no core file.
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import scenarioData from "./scenarioData.json";
import { getSetting } from "./settings";

type Step = Record<string, unknown>;
export type Scenario = { id: string; family: string; vendor?: string; extractor?: string; steps: Step[]; expect: Record<string, unknown>; description?: string };

const ATT = { routing: "011000015", accountNumber: "900012345678" };
const LEGIT = { routing: "031000503", accountNumber: "55501234567" };
const CUSTOM: Scenario[] = [
  {
    id: "custom_change_in_thread", family: "custom", vendor: "cleanco", description: "A bank-change email in the active thread from the vendor's real address. The vendor of record then reports that nothing arrived.",
    steps: [
      { inject: { from: "ap@cleanco.example", dmarc: true, subject: "Updated banking details", body: `Hi Marisol,\n\nWe have changed banks effective this month. Please update our remittance details for all open and future invoices:\nRouting (ABA): ${ATT.routing}\nAccount number: ${ATT.accountNumber}\n\nThanks,\nDana`, account: ATT } },
      { expect_case: { state: "PROBE_SENT" } }, { pay: { invoice: "cleanco_open" } }, { expect_pay: { ok: false, reason: "destination_not_verified" } },
      { advance_to: "availability" }, { expect_case: { state: "AWAITING_CONFIRMATION" } }, { vendor_statement: "nothing" }, { expect_case: { state: "NEEDS_HUMAN" } },
      { pay: { invoice: "cleanco_open" } }, { expect_pay: { ok: false, reason: "destination_not_verified" } },
    ],
    expect: { final_state: "NEEDS_HUMAN", payments_created: 0 },
  },
  {
    id: "custom_change_in_pdf_footer", family: "custom", vendor: "cleanco", description: "An invoice whose body says nothing; the new remit account is only in the PDF footer.",
    steps: [
      { inject: { from: "ap@cleanco.example", dmarc: true, subject: "Invoice CC-2026-0419", body: "Hi, attached is invoice CC-2026-0419 for October deep-clean services. Thanks, Dana", attachmentText: `INVOICE CC-2026-0419\nCleanCo Facilities\nAmount due: $18,400.00\n\nRemit to: First Harbor Bank  ABA ${ATT.routing}  Account ${ATT.accountNumber}`, invoice: { number: "CC-2026-0419", amountCents: 1840000 }, account: ATT } },
      { expect_case: { state: "PROBE_SENT" } }, { advance_to: "availability" }, { vendor_statement: "nothing" }, { expect_case: { state: "NEEDS_HUMAN" } },
      { pay: { invoice: "cleanco_open" } }, { expect_pay: { ok: false, reason: "destination_not_verified" } },
    ],
    expect: { final_state: "NEEDS_HUMAN", payments_created: 0 },
  },
  {
    id: "custom_legit_change", family: "custom", vendor: "cleanco", description: "A real bank change: the vendor of record reads back the probe amount; the invoice is paid and lands.",
    steps: [
      { inject: { from: "ap@cleanco.example", dmarc: true, subject: "New bank account", body: `Hi Marisol,\n\nCleanCo has moved to a new bank. Please update our remittance details for all open invoices:\nRouting (ABA): ${LEGIT.routing}\nAccount number: ${LEGIT.accountNumber}\n\nThanks,\nDana Whitfield, CleanCo Facilities`, account: LEGIT } },
      { expect_case: { state: "PROBE_SENT" } }, { advance_to: "availability" }, { vendor_statement: "correct" }, { expect_case: { state: "VERIFIED", accountStatus: "verified" } },
      { pay: { invoice: "cleanco_open" } }, { expect_pay: { ok: true } }, { expect_case: { state: "PAID" } }, { advance_to: "landing_check" }, { landing_statement: "correct" }, { expect_case: { state: "CLOSED" } },
    ],
    expect: { final_state: "CLOSED", payments_created: 1 },
  },
];

export function allScenarios(): Scenario[] {
  return [...CUSTOM, ...(scenarioData as unknown as Scenario[])];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const scenarios = query({
  args: {},
  handler: async () =>
    allScenarios().map((s) => ({ id: s.id, family: s.family, vendor: s.vendor ?? "cleanco", description: s.description ?? null, steps: s.steps.map((st) => Object.keys(st)[0]), expect: s.expect })),
});

export const get = query({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => ctx.db.query("evalRuns").withIndex("by_scenario", (q) => q.eq("scenarioId", `judge:${runId}`)).first(),
});

export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("evalRuns").order("desc").take(200);
    return rows.filter((r) => r.scenarioId.startsWith("judge:")).slice(0, 10);
  },
});

export const upsert = internalMutation({
  args: { runId: v.string(), patch: v.any() },
  handler: async (ctx, { runId, patch }) => {
    const existing = await ctx.db.query("evalRuns").withIndex("by_scenario", (q) => q.eq("scenarioId", `judge:${runId}`)).first();
    if (existing) await ctx.db.patch(existing._id, patch as Record<string, unknown>);
    else await ctx.db.insert("evalRuns", { scenarioId: `judge:${runId}`, startedAt: Date.now(), expected: {}, actual: {}, ...(patch as Record<string, unknown>) });
  },
});

export const flag = internalQuery({ args: {}, handler: async (ctx) => (await getSetting(ctx, "judgeMode")) ?? "on" });

export const messageStatus = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const m = await ctx.db.get(messageId);
    return m ? { status: m.intakeStatus, result: (m.intakeResult ?? {}) as Record<string, unknown> } : null;
  },
});

export const vendorInfo = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const vnd = (await ctx.db.query("vendors").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) ?? (await ctx.db.query("vendors").collect()).find((x) => x.domain.split(".")[0] === slug) ?? null;
    if (!vnd) return null;
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_vendor", (q) => q.eq("vendorId", vnd._id)).collect();
    const invoices = await ctx.db.query("invoices").withIndex("by_vendor", (q) => q.eq("vendorId", vnd._id)).collect();
    const cases = await ctx.db.query("cases").withIndex("by_vendor", (q) => q.eq("vendorId", vnd._id)).collect();
    return { vendorId: vnd._id, accounts: accounts.map((a) => ({ _id: a._id, status: a.status })), invoices: invoices.map((i) => ({ _id: i._id, number: i.number, status: i.status, dueAt: i.dueAt })), cases: cases.sort((a, b) => b.openedAt - a.openedAt).map((c) => ({ _id: c._id, state: c.state })) };
  },
});

export const caseInfo = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const acct = await ctx.db.get(c.newAccountId);
    const timers = await ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const confs = await ctx.db.query("confirmations").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const pkg = await ctx.db.query("packages").withIndex("by_case", (q) => q.eq("caseId", caseId)).first();
    const payments = await ctx.db.query("payments").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    const record = (await ctx.db.query("contacts").withIndex("by_vendor", (q) => q.eq("vendorId", c.vendorId)).collect()).find((k) => k.kind === "portal" && k.trustLevel === "record");
    const tokens = (await ctx.db.query("confirmTokens").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()).filter((t) => t.usedAt === undefined);
    return { state: c.state, humanReason: c.humanReason ?? null, accountStatus: acct?.status ?? null, newAccountId: c.newAccountId, timers: timers.map((t) => ({ kind: t.kind, dueAt: t.dueAt, fired: t.fired })), confirmations: confs.map((x) => ({ channel: x.channel, accepted: x.accepted })), hasPackage: !!pkg, payments: payments.map((p) => ({ amountCents: p.amountCents, landingState: p.landingState })), portalContactId: record?._id ?? null, portalToken: tokens[0]?.token ?? null };
  },
});

export const paymentsTotal = internalQuery({ args: {}, handler: async (ctx) => (await ctx.db.query("payments").collect()).length });

export const run = action({
  args: { scenarioId: v.string(), extractorOff: v.optional(v.boolean()), reset: v.optional(v.boolean()) },
  handler: async (ctx, { scenarioId, extractorOff, reset }): Promise<{ runId: string }> => {
    if ((await ctx.runQuery(internal.judge.flag, {})) === "off") throw new Error("judge mode is off (Settings)");
    const spec = allScenarios().find((s) => s.id === scenarioId);
    if (!spec) throw new Error("unknown scenario");
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const off = !!extractorOff;
    const stepsView: { name: string; status: "pending" | "running" | "ok" | "fail" | "skipped"; note?: string }[] = spec.steps.map((st) => ({ name: Object.keys(st)[0], status: "pending" }));
    const state: { caseId?: Id<"cases">; lastPay?: { ok: boolean; reason?: string }; crafted?: Id<"invoices">; extraVendorInvoice?: Id<"invoices">; vendorSlug: string; failures: string[] } = { vendorSlug: spec.vendor ?? "cleanco", failures: [] };
    const push = async (extra: Record<string, unknown> = {}) =>
      ctx.runMutation(internal.judge.upsert, { runId, patch: { expected: spec.expect, actual: { scenarioId, extractorOff: off, caseId: state.caseId ?? null, steps: stepsView, failures: state.failures, ...extra } } });
    await push({ status: "starting" });
    // Fresh seed so every judge run starts from the same fixtures (same as the eval runner).
    if (reset !== false) await ctx.runAction(internal.seed.reseedInternal, { which: "full" });
    await ctx.runMutation(internal.settingsInternal.setInternal, { key: "extractorMode", value: off ? "off" : spec.extractor ?? "rules" });

    const vendor = async (slug = state.vendorSlug) => {
      const vi = await ctx.runQuery(internal.judge.vendorInfo, { slug });
      if (!vi) throw new Error(`vendor ${slug} not found`);
      return vi;
    };
    const caseInfo = async () => (state.caseId ? ctx.runQuery(internal.judge.caseInfo, { caseId: state.caseId }) : null);

    for (let i = 0; i < spec.steps.length; i++) {
      const [name, rawArg] = Object.entries(spec.steps[i])[0];
      const arg = (rawArg ?? {}) as Record<string, unknown>;
      stepsView[i].status = "running";
      await push({ status: "running" });
      try {
        if (off && typeof rawArg === "object" && rawArg && (rawArg as Record<string, unknown>).skip_when_off) {
          stepsView[i].status = "skipped"; stepsView[i].note = "skipped with the extractor off"; continue;
        }
        switch (name) {
          case "inject": {
            if (off) {
              const acct = arg.account as { routing: string; accountNumber: string } | undefined;
              if (!acct) { stepsView[i].status = "skipped"; stepsView[i].note = "no account to substitute"; continue; }
              const vi = await vendor((arg.vendor as string) ?? state.vendorSlug);
              const cur = vi.accounts.find((a) => a.status === "verified");
              const r = await ctx.runAction(api.bankAccounts.manualEdit, { vendorId: vi.vendorId, routing: acct.routing, accountNumber: acct.accountNumber, replacesAccountId: cur?._id });
              state.caseId = r.caseId ?? state.caseId;
              stepsView[i].note = `manual edit instead of email (AI off) → case ${r.caseId}`;
              await sleep(1500);
              break;
            }
            const messageId = await ctx.runMutation(internal.messages.insertInternal, { from: String(arg.from), subject: String(arg.subject ?? ""), body: String(arg.body ?? ""), dmarc: arg.dmarc as boolean | undefined, attachmentText: arg.attachmentText as string | undefined, invoice: arg.invoice as { number: string; amountCents: number; dueInDays?: number } | undefined });
            let res: Record<string, unknown> = {};
            for (let k = 0; k < 120; k++) {
              const m = await ctx.runQuery(internal.judge.messageStatus, { messageId });
              if (m && m.status !== "pending") { res = m.result; break; }
              await sleep(500);
            }
            if (res.caseId) state.caseId = res.caseId as Id<"cases">;
            else if (!state.caseId) { const vi = await vendor(); state.caseId = vi.cases.find((c) => c.state !== "CLOSED")?._id; }
            stepsView[i].note = `intake: ${String(res.outcome ?? "?")} (${String(res.mode ?? "?")})`;
            await sleep(1500);
            break;
          }
          case "manual_edit": {
            const vi = await vendor((arg.vendor as string) ?? state.vendorSlug);
            const cur = vi.accounts.find((a) => a.status === "verified");
            const r = await ctx.runAction(api.bankAccounts.manualEdit, { vendorId: vi.vendorId, routing: String(arg.routing), accountNumber: String(arg.accountNumber), replacesAccountId: cur?._id });
            state.caseId = r.caseId ?? state.caseId;
            stepsView[i].note = `case ${r.caseId}`;
            await sleep(1500);
            break;
          }
          case "expect_case": {
            const c = await caseInfo();
            if (!c) { if (arg.state && arg.state !== "none") state.failures.push(`expect_case: no case`); break; }
            if (arg.state && c.state !== arg.state) state.failures.push(`expect_case state=${arg.state} got=${c.state}`);
            if (arg.humanReason && c.humanReason !== arg.humanReason) state.failures.push(`expect_case humanReason=${arg.humanReason} got=${c.humanReason}`);
            if (arg.accountStatus && c.accountStatus !== arg.accountStatus) state.failures.push(`expect_case accountStatus=${arg.accountStatus} got=${c.accountStatus}`);
            stepsView[i].note = `state ${c.state}${c.humanReason ? ` (${c.humanReason})` : ""}`;
            break;
          }
          case "advance_to": {
            const kind = typeof rawArg === "string" ? rawArg : String(arg.timer);
            const map: Record<string, string> = { settle: "probe_settle", availability: "probe_available", sla: "confirmation_sla", landing_check: "landing_check", landing_deadline: "landing_deadline" };
            const want = map[kind] ?? kind;
            const c = await caseInfo();
            const t = c?.timers.find((x) => x.kind === want && !x.fired);
            if (!t) { state.failures.push(`advance_to ${kind}: no pending timer`); break; }
            await ctx.runMutation(api.clock.advanceTo, { at: t.dueAt + 1000 });
            stepsView[i].note = `clock → ${new Date(t.dueAt + 1000).toISOString().slice(0, 16)}Z (${want})`;
            await sleep(2500);
            break;
          }
          case "advance": {
            const ms = Number(arg.hours ?? 0) * 3600_000 + Number(arg.days ?? 0) * 86_400_000;
            await ctx.runMutation(api.clock.advance, { ms });
            stepsView[i].note = `+${(ms / 3600_000).toFixed(0)}h`;
            await sleep(2000);
            break;
          }
          case "vendor_statement": case "landing_statement": {
            const kind = typeof rawArg === "string" ? rawArg : String(arg.value ?? "nothing");
            if (!state.caseId) throw new Error("no case");
            const landing = name === "landing_statement";
            let stated: number | null = null; let outcome: "stated" | "nothing_arrived" | "no_answer" = "nothing_arrived";
            if (landing) {
              const c = await caseInfo();
              if (kind === "correct" && c?.payments[0]) { stated = c.payments[0].amountCents; outcome = "stated"; }
            } else if (kind === "correct" || kind === "wrong") {
              // The amount is read server-side only; it never leaves this action.
              const amt = await ctx.runQuery(internal.probes.amountForTest, { caseId: state.caseId });
              if (amt === null) throw new Error("no probe");
              stated = kind === "correct" ? amt : amt === 99 ? 11 : amt + 1; outcome = "stated";
            } else if (kind === "voicemail" || kind === "no_answer") outcome = "no_answer";
            else if (/^\d+$/.test(kind)) { stated = Number(kind); outcome = "stated"; }
            const r = await ctx.runMutation(internal.channels.simVoice.answerInternal, { caseId: state.caseId, statedAmountCents: stated, outcome, mode: landing ? "landing" : "probe" });
            stepsView[i].note = `${kind} → ${r.delivered ? "delivered" : `stored (${r.reason})`}`;
            await sleep(1000);
            break;
          }
          case "expect_confirmation": {
            const c = await caseInfo();
            const confs = (c?.confirmations ?? []).filter((x) => x.channel === arg.channel);
            if (!confs.length) state.failures.push(`expect_confirmation: none on channel ${arg.channel}`);
            else if (typeof arg.accepted === "boolean" && confs[confs.length - 1].accepted !== arg.accepted) state.failures.push(`expect_confirmation accepted=${arg.accepted}`);
            stepsView[i].note = confs.length ? `${arg.channel}: accepted=${confs[confs.length - 1].accepted}` : "none";
            break;
          }
          case "pay": {
            const ref = String(arg.invoice ?? "cleanco_open");
            let invoiceId: Id<"invoices"> | undefined;
            if (ref === "crafted") invoiceId = state.crafted;
            else if (ref === "new_vendor_open") invoiceId = state.extraVendorInvoice;
            else if (["cleanco_open", "open", "vendor_open"].includes(ref)) {
              const vi = await vendor();
              invoiceId = vi.invoices.filter((x) => x.status !== "paid").sort((a, b) => a.dueAt - b.dueAt)[0]?._id;
            } else {
              const inv = await ctx.runQuery(internal.evalQueries.invoiceByNumber, { number: ref });
              invoiceId = inv?._id;
            }
            if (!invoiceId) throw new Error(`invoice ${ref} not found`);
            const r = await ctx.runMutation(api.payments.send, { invoiceId, initiatedBy: "judge", rail: (arg.rail as "ach" | "wire" | undefined) ?? "ach" });
            state.lastPay = r.ok ? { ok: true } : { ok: false, reason: r.reason };
            stepsView[i].note = r.ok ? `paid (${r.duplicate ? "duplicate returned" : "new payment"})` : `refused: ${r.reason}`;
            await sleep(1000);
            break;
          }
          case "expect_pay": {
            if (!state.lastPay) { state.failures.push("expect_pay without pay"); break; }
            if (state.lastPay.ok !== arg.ok) state.failures.push(`expect_pay ok=${arg.ok} got ${JSON.stringify(state.lastPay)}`);
            if (arg.reason && state.lastPay.reason !== arg.reason) state.failures.push(`expect_pay reason=${arg.reason} got=${state.lastPay.reason}`);
            stepsView[i].note = state.lastPay.ok ? "payment accepted" : `refused: ${state.lastPay.reason}`;
            break;
          }
          case "craft_invoice": {
            const vi = await vendor((arg.vendor as string) ?? state.vendorSlug);
            const rv = arg.remit_vendor ? await vendor(String(arg.remit_vendor)) : vi;
            const want = arg.remit === "old" ? "superseded" : "verified";
            const acct = rv.accounts.find((a) => a.status === want);
            if (!acct) throw new Error("craft_invoice: no matching account");
            state.crafted = await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId: vi.vendorId, remitAccountId: acct._id, number: String(arg.number ?? `JUDGE-${runId}`), amountCents: Number(arg.amountCents ?? 250000) });
            stepsView[i].note = `invoice remitting to a ${want} account`;
            break;
          }
          case "create_vendor": {
            const vendorId = await ctx.runMutation(internal.evalQueries.createVendor, { name: String(arg.name), domain: String(arg.domain), slug: String(arg.slug), phone: arg.phone ? String(arg.phone) : undefined, phoneTrust: arg.phoneTrust as "record" | "untrusted" | "discovered" | undefined });
            if (arg.routing && arg.accountNumber) {
              const acct = await ctx.runAction(internal.bankAccounts.createUnverified, { vendorId, routing: String(arg.routing), accountNumberPlain: String(arg.accountNumber), createdVia: "seed" });
              if (acct.caseId) state.caseId = acct.caseId;
              if (arg.invoiceAmountCents) state.extraVendorInvoice = await ctx.runMutation(internal.evalQueries.craftInvoice, { vendorId, remitAccountId: acct.accountId, number: String(arg.invoiceNumber ?? `NEW-${runId}`), amountCents: Number(arg.invoiceAmountCents) });
            }
            state.vendorSlug = String(arg.slug);
            stepsView[i].note = `vendor ${arg.name} created`;
            await sleep(1500);
            break;
          }
          case "portal_confirm": {
            const kind = typeof rawArg === "string" ? rawArg : String(arg.value ?? "correct");
            const c = await caseInfo();
            if (!c?.portalContactId || !c.portalToken || !state.caseId) throw new Error("portal_confirm: no open portal request");
            const session = await ctx.runMutation(internal.channels.portal.createSession, { username: state.vendorSlug });
            const amt = await ctx.runQuery(internal.probes.amountForTest, { caseId: state.caseId });
            const stated = kind === "correct" ? amt : (amt ?? 0) + 1;
            const r = await ctx.runMutation(internal.channels.portal.confirmInternal, { sessionToken: session.token, token: c.portalToken, statedAmountCents: stated });
            stepsView[i].note = r.verified ? "portal: verified" : `portal: not verified (${r.attemptsLeft} attempts left)`;
            await sleep(1000);
            break;
          }
          case "set_setting": { await ctx.runMutation(internal.settingsInternal.setInternal, { key: String(arg.key), value: String(arg.value) }); break; }
          case "expect_account": { const c = await caseInfo(); if (c?.accountStatus !== arg.status) state.failures.push(`expect_account ${arg.status} got ${c?.accountStatus}`); stepsView[i].note = `account ${c?.accountStatus}`; break; }
          case "mark_fraud": { if (!state.caseId) throw new Error("no case"); await ctx.runMutation(api.cases.markFraud, { caseId: state.caseId, reason: String(arg.reason ?? "judge: marked fraud") }); await sleep(2000); break; }
          case "expect_package": {
            let ok = false;
            for (let k = 0; k < 45 && !ok; k++) { const c = await caseInfo(); ok = !!c?.hasPackage; if (!ok) await sleep(2000); }
            if (!ok) state.failures.push("expect_package: not generated within 90s");
            stepsView[i].note = ok ? "package generated" : "no package";
            break;
          }
          default:
            throw new Error(`unknown step ${name}`);
        }
        stepsView[i].status = state.failures.length && stepsView[i].status === "running" && name.startsWith("expect") && state.failures[state.failures.length - 1]?.startsWith(name) ? "fail" : "ok";
      } catch (e) {
        stepsView[i].status = "fail";
        stepsView[i].note = String((e as Error)?.message ?? e);
        state.failures.push(`${name}: ${stepsView[i].note}`);
        await push({ status: "running" });
        break;
      }
      await push({ status: "running" });
    }

    const c = await caseInfo();
    const payments = await ctx.runQuery(internal.judge.paymentsTotal, {});
    const actualFinal = { final_state: c?.state ?? null, payments_created: payments, account_status: c?.accountStatus ?? null, humanReason: c?.humanReason ?? null };
    for (const [k, want] of Object.entries(spec.expect)) {
      if (k in actualFinal && (actualFinal as Record<string, unknown>)[k] !== want) state.failures.push(`expect.${k}=${String(want)} got=${String((actualFinal as Record<string, unknown>)[k])}`);
    }
    await ctx.runMutation(internal.judge.upsert, { runId, patch: { finishedAt: Date.now(), passed: state.failures.length === 0, expected: spec.expect, actual: { scenarioId, extractorOff: off, caseId: state.caseId ?? null, steps: stepsView, failures: state.failures, status: "done", ...actualFinal } } });
    return { runId };
  },
});
