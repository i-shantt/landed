import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const modules = import.meta.glob("../convex/**/*.ts");

export type T = ReturnType<typeof convexTest>;

export async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.action(internal.seed.reseedInternal, { which: "minimal" });
  await drain(t);
  return { t, ids };
}

/** Run every scheduled function (dispatch hops) until quiet. */
export async function drain(t: T) {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

export async function advance(t: T, ms: number) {
  const res = await t.mutation(api.clock.advance, { ms });
  await drain(t);
  return res;
}

export async function getCase(t: T, caseId: Id<"cases">) {
  return (await t.run(async (ctx) => ctx.db.get(caseId)))!;
}
export async function getAccount(t: T, accountId: Id<"bankAccounts">) {
  return (await t.run(async (ctx) => ctx.db.get(accountId)))!;
}
/** TEST ONLY: reads the secret probe amount straight from the table. */
export async function probeAmount(t: T, caseId: Id<"cases">) {
  return t.run(async (ctx) => {
    const c = (await ctx.db.get(caseId))!;
    const p = (await ctx.db.get(c.probeId!))!;
    return p.amountCents;
  });
}
export async function events(t: T, caseId: Id<"cases">) {
  return t.run(async (ctx) => ctx.db.query("events").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect());
}

/** Manual edit for a vendor; returns account + case ids. Drains dispatch hops. */
export async function manualEdit(t: T, vendorId: Id<"vendors">, routing: string, accountNumber: string, replacesAccountId?: Id<"bankAccounts">) {
  const res = await t.action(api.bankAccounts.manualEdit, { vendorId, routing, accountNumber, replacesAccountId });
  await drain(t);
  return res as { accountId: Id<"bankAccounts">; caseId: Id<"cases">; reused: boolean };
}

/** Advance until the case's probe is available (probe_available timer fired). */
export async function advanceToAvailability(t: T, caseId: Id<"cases">) {
  const timers = await t.run(async (ctx) => ctx.db.query("timers").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect());
  const avail = timers.find((x) => x.kind === "probe_available");
  if (!avail) throw new Error("no probe_available timer");
  const now = (await t.query(api.clock.get, {})).now;
  await advance(t, Math.max(0, avail.dueAt - now) + 1000);
}

export async function vendorStatement(t: T, caseId: Id<"cases">, statedAmountCents: number | null, outcome?: "stated" | "nothing_arrived" | "no_answer") {
  const res = await t.mutation(api.channels.simVoice.answer, { caseId, statedAmountCents, outcome });
  await drain(t);
  return res;
}

export async function pay(t: T, invoiceId: Id<"invoices">, rail: "ach" | "wire" = "ach") {
  const res = await t.mutation(api.payments.send, { invoiceId, initiatedBy: "test-clerk", rail });
  await drain(t);
  if (!res.ok) return { ok: false as const, reason: res.reason };
  return { ok: true as const, paymentId: res.paymentId, duplicate: res.duplicate };
}

export const VENDOR_B_ACCOUNT = { routing: "011000015", accountNumber: "900012345678" }; // mule / new account
export const VENDOR_C_ACCOUNT = { routing: "031000503", accountNumber: "55501234567" };
