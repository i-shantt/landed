// Seeds fixtures. `reset` wipes every table. The minimal inline fixture is used
// by Tier 1 tests; the generated /fixtures data (bundled as fixtureData.json)
// is used by the app.
import { action, internalAction, internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import bcrypt from "bcryptjs";
import { hashAndEncrypt } from "./crypto";
import { seedOperators } from "./controls/operators";
import type { Fixture } from "./fixtureTypes";
import { setSetting } from "./settings";
import { createUnverifiedWithHash } from "./bankAccounts";
import fixtureData from "./fixtureData.json";

const TABLES: TableNames[] = [
  "company", "clock", "vendors", "contacts", "bankAccounts", "messages", "invoices", "cases", "probes",
  "confirmations", "payments", "events", "timers", "packages", "portalCredentials", "portalSessions",
  "confirmTokens", "simLedger", "settings",
];
// `evalRuns` is intentionally NOT wiped by reset: eval results survive a re-seed so the /eval page keeps the last run.

export const DAY = 86_400_000;

export function minimalFixture(now: number): Fixture {
  return {
    company: { name: "Meridian Outdoor Co.", domain: "meridianoutdoor.example", timezone: "America/Los_Angeles", bankRouting: "121000358", bankLast4: "0001" },
    vendors: [
      { slug: "cleanco", name: "CleanCo Facilities", domain: "cleanco.example", onboardedAt: now - 400 * DAY, hasPortalLogin: true },
      { slug: "northpeak", name: "NorthPeak Logistics", domain: "northpeak.example", onboardedAt: now - 300 * DAY, hasPortalLogin: false },
    ],
    contacts: [
      { vendorSlug: "cleanco", kind: "phone", value: "+15550100001", trustLevel: "record", establishedAt: now - 400 * DAY, establishedVia: "onboarding_form_and_verified_call" },
      { vendorSlug: "cleanco", kind: "portal", value: "cleanco", trustLevel: "record", establishedAt: now - 400 * DAY, establishedVia: "onboarding_form_and_verified_call" },
      { vendorSlug: "northpeak", kind: "phone", value: "+15550100002", trustLevel: "record", establishedAt: now - 300 * DAY, establishedVia: "onboarding_form_and_verified_call" },
    ],
    bankAccounts: [
      { vendorSlug: "cleanco", key: "cleanco_main", routing: "021000021", accountNumber: "483920117", status: "verified", firstPaidAt: now - 380 * DAY },
      { vendorSlug: "northpeak", key: "northpeak_main", routing: "026009593", accountNumber: "77120034561", status: "verified", firstPaidAt: now - 280 * DAY },
    ],
    invoices: [
      { vendorSlug: "cleanco", number: "CC-2026-0412", amountCents: 4_200_000, issuedAt: now - 8 * DAY, dueAt: now + 6 * DAY, remitAccountKey: "cleanco_main", status: "open" },
      { vendorSlug: "northpeak", number: "NP-77102", amountCents: 1_825_000, issuedAt: now - 5 * DAY, dueAt: now + 9 * DAY, remitAccountKey: "northpeak_main", status: "open" },
    ],
    payments: [],
    messages: [],
    portalCredentials: [{ vendorSlug: "cleanco", username: "cleanco", password: "landed-demo" }],
  };
}

export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deleted = 0;
    for (const table of TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const r of rows) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    return deleted;
  },
});

type Prepared = {
  fixture: Fixture;
  accounts: { key: string; vendorSlug: string; routing: string; accountLast4: string; accountHash: string; accountCiphertext: string; status: "verified" | "unverified"; firstPaidAt?: number }[];
  creds: { vendorSlug: string; username: string; passwordHash: string }[];
  extractorMode: string;
};

export async function insertFixture(ctx: MutationCtx, prepared: Prepared) {
  const { fixture, accounts, creds } = prepared;
  const now = Date.now();
  await ctx.db.insert("company", fixture.company);
  await ctx.db.insert("clock", { mode: "demo", offsetMs: 0 });
  await setSetting(ctx, "extractorMode", prepared.extractorMode);
  await setSetting(ctx, "rail", process.env.RAIL === "nessie" && process.env.NESSIE_KEY ? "nessie" : "sim");
  await setSetting(ctx, "voice", process.env.VOICE === "vapi" && process.env.VAPI_API_KEY ? "vapi" : "sim");
  await setSetting(ctx, "seededAt", String(now));
  await seedOperators(ctx);

  const vendorIds = new Map<string, Id<"vendors">>();
  for (const vnd of fixture.vendors) {
    const id = await ctx.db.insert("vendors", { ...vnd });
    vendorIds.set(vnd.slug, id);
  }
  const portalContactIds = new Map<string, Id<"contacts">>();
  for (const c of fixture.contacts) {
    const vendorId = vendorIds.get(c.vendorSlug)!;
    const id = await ctx.db.insert("contacts", { vendorId, kind: c.kind, value: c.value, trustLevel: c.trustLevel, establishedAt: c.establishedAt, establishedVia: c.establishedVia });
    if (c.kind === "portal" && c.trustLevel === "record") portalContactIds.set(c.vendorSlug, id);
  }
  const accountIds = new Map<string, Id<"bankAccounts">>();
  const pendingUnverified: typeof accounts = [];
  for (const a of accounts) {
    const vendorId = vendorIds.get(a.vendorSlug)!;
    if (a.status === "verified") {
      const id = await ctx.db.insert("bankAccounts", {
        vendorId,
        identityKey: `${vendorId}:${a.accountHash}`,
        version: 1,
        routing: a.routing,
        accountLast4: a.accountLast4,
        accountHash: a.accountHash,
        accountCiphertext: a.accountCiphertext,
        status: "verified",
        firstPaidAt: a.firstPaidAt ?? now - 30 * DAY,
        createdVia: "seed",
      });
      accountIds.set(a.key, id);
    } else {
      pendingUnverified.push(a);
    }
  }
  const invoiceIds = new Map<string, Id<"invoices">>();
  for (const inv of fixture.invoices) {
    const remit = accountIds.get(inv.remitAccountKey);
    if (!remit) continue;
    const id = await ctx.db.insert("invoices", { vendorId: vendorIds.get(inv.vendorSlug)!, number: inv.number, amountCents: inv.amountCents, issuedAt: inv.issuedAt, dueAt: inv.dueAt, remitAccountId: remit, status: inv.status });
    invoiceIds.set(inv.number, id);
  }
  // Historical payments are NOT inserted as payment rows: payments.send is the only writer of
  // `payments` (I1). History is represented by invoices with status "paid" and firstPaidAt on accounts.
  for (const m of fixture.messages) {
    await ctx.db.insert("messages", {
      vendorId: m.vendorSlug ? vendorIds.get(m.vendorSlug) : undefined,
      threadId: m.threadId,
      from: m.from,
      to: m.to,
      subject: m.subject,
      body: m.body,
      sentAt: m.sentAt,
      channel: "email",
      authResult: { spf: m.dmarc, dkim: m.dmarc, dmarc: m.dmarc },
      attachmentStorageIds: [],
      intakeStatus: "done",
      intakeResult: { changed: false, mode: "seed", historical: true },
    });
  }
  for (const c of creds) {
    const vendorId = vendorIds.get(c.vendorSlug)!;
    const contactId = portalContactIds.get(c.vendorSlug);
    if (!contactId) continue;
    await ctx.db.insert("portalCredentials", { vendorId, username: c.username, passwordHash: c.passwordHash, contactId });
  }
  // Never-paid accounts seeded as unverified open a case (I2).
  for (const a of pendingUnverified) {
    const vendorId = vendorIds.get(a.vendorSlug)!;
    const res = await createUnverifiedWithHash(ctx, { vendorId, routing: a.routing, accountLast4: a.accountLast4, accountHash: a.accountHash, accountCiphertext: a.accountCiphertext, createdVia: "seed" });
    accountIds.set(a.key, res.accountId);
  }
  await ctx.db.insert("events", { at: now, actor: "system", type: "seeded", payload: { vendors: fixture.vendors.length, accounts: accounts.length, invoices: fixture.invoices.length, extractorMode: prepared.extractorMode } });
  return { vendors: Object.fromEntries(vendorIds), accounts: Object.fromEntries(accountIds), invoices: Object.fromEntries(invoiceIds) };
}

export const insert = internalMutation({
  args: { prepared: v.any() },
  handler: async (ctx, { prepared }) => insertFixture(ctx, prepared as Prepared),
});

async function prepare(fixture: Fixture): Promise<Prepared> {
  const accounts = [];
  for (const a of fixture.bankAccounts) {
    const enc = await hashAndEncrypt(a.routing, a.accountNumber);
    accounts.push({ key: a.key, vendorSlug: a.vendorSlug, routing: enc.routing, accountLast4: enc.accountLast4, accountHash: enc.accountHash, accountCiphertext: enc.accountCiphertext, status: a.status, firstPaidAt: a.firstPaidAt });
  }
  const creds = [];
  for (const c of fixture.portalCredentials) {
    creds.push({ vendorSlug: c.vendorSlug, username: c.username, passwordHash: await bcrypt.hash(c.password, 6) });
  }
  const extractorMode = process.env.ANTHROPIC_API_KEY ? "claude" : "rules";
  console.log(`[seed] extractorMode=${extractorMode} rail=${process.env.RAIL ?? "sim"} voice=${process.env.VOICE ?? "sim"}`);
  return { fixture, accounts, creds, extractorMode };
}

/** Internal: reset + seed. which = "minimal" | "full". */
export const reseedInternal = internalAction({
  args: { which: v.optional(v.union(v.literal("minimal"), v.literal("full"))), demo: v.optional(v.boolean()) },
  handler: async (ctx, { which, demo }): Promise<{ deleted: number; vendors: Record<string, string>; accounts: Record<string, string>; invoices: Record<string, string>; demoCases?: { caseId: string; label: string }[] }> => {
    const deleted: number = await ctx.runMutation(internal.seed.reset, {});
    const fixture: Fixture = which === "minimal" ? minimalFixture(Date.now()) : rebase(fixtureData as unknown as Fixture, Date.now());
    const prepared = await prepare(fixture);
    const ids: { vendors: Record<string, string>; accounts: Record<string, string>; invoices: Record<string, string> } = await ctx.runMutation(internal.seed.insert, { prepared });
    // Opt-in pre-run demo cases (Settings re-seed and prod-seed pass demo:true; eval/judge do not).
    let demoCases: { caseId: string; label: string }[] | undefined;
    if (demo && which !== "minimal") demoCases = await ctx.runAction(internal.seedDemo.createDemoCases, {});
    return { deleted, ...ids, demoCases };
  },
});

/** Fixture timestamps are relative to `generatedAt`; shift them to now. */
export function rebase(fx: Fixture & { generatedAt?: number }, now: number): Fixture {
  const base = fx.generatedAt ?? now;
  const shift = now - base;
  const s = (t: number) => t + shift;
  return {
    company: fx.company,
    vendors: fx.vendors.map((x) => ({ ...x, onboardedAt: s(x.onboardedAt) })),
    contacts: fx.contacts.map((x) => ({ ...x, establishedAt: s(x.establishedAt) })),
    bankAccounts: fx.bankAccounts.map((x) => ({ ...x, firstPaidAt: x.firstPaidAt !== undefined ? s(x.firstPaidAt) : undefined })),
    invoices: fx.invoices.map((x) => ({ ...x, issuedAt: s(x.issuedAt), dueAt: s(x.dueAt) })),
    payments: fx.payments.map((x) => ({ ...x, sentAt: s(x.sentAt) })),
    messages: fx.messages.map((x) => ({ ...x, sentAt: s(x.sentAt) })),
    portalCredentials: fx.portalCredentials,
  };
}

/** Human (Settings page): dangerous re-seed. */
export const reseed = action({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    if (!(await ctx.runQuery(internal.controls.demoGuard.check, {}))) throw new ConvexError("demo_controls_disabled");
    const res = await ctx.runAction(internal.seed.reseedInternal, { which: "full", demo: true });
    return { deleted: res.deleted };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const company = await ctx.db.query("company").first();
    const vendors = await ctx.db.query("vendors").collect();
    return { seeded: !!company, companyName: company?.name ?? null, vendorCount: vendors.length };
  },
});
