// Sanctions / watchlist screening (controls layer, additive). A vendor name is scored against the
// watchlist at onboarding and on demand; every run writes an immutable `screenings` row (subject,
// list version, score, algorithm) so the disposition is auditable. The policy engine
// (controls/policy.ts, `blockOnScreeningHit`) refuses payments while a potential or confirmed match
// is unresolved; only a named approver/admin may resolve one, and automation never confirms a match.
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { now } from "../clock";
import { append } from "../events";
import { requireActor } from "../controls/actor";
import { classify, scoreNames, REPORT_ABOVE, STRONG_MATCH_THRESHOLD, type Classification, type MatchMethod } from "./match";
import { DEMO_LIST_VERSION, DEMO_WATCHLIST, watchlistNames, type WatchlistEntry } from "./watchlist";

export type ScreenMatch = { entry: string; program: string; score: number; method: MatchMethod };

export type ScreenResult = {
  subject: string;
  listVersion: string;
  status: Classification;
  /** True when the top score is at or above STRONG_MATCH_THRESHOLD (still needs a human). */
  strong: boolean;
  matches: ScreenMatch[];
};

/**
 * Pure: score a name against the list. One match per list entry (the best of its primary name and
 * aliases), sorted by score, keeping those at or above `reportAbove` for the audit trail.
 */
export function screenName(name: string, opts: { list?: WatchlistEntry[]; listVersion?: string; reportAbove?: number } = {}): ScreenResult {
  const list = opts.list ?? DEMO_WATCHLIST;
  const reportAbove = opts.reportAbove ?? REPORT_ABOVE;
  const best = new Map<number, ScreenMatch>();
  for (const { entry, name: listName } of watchlistNames(list)) {
    const s = scoreNames(name, listName);
    if (s.score < reportAbove) continue;
    const prev = best.get(entry.ent_num);
    if (!prev || s.score > prev.score) best.set(entry.ent_num, { entry: entry.name, program: entry.program, score: s.score, method: s.method });
  }
  const matches = [...best.values()].sort((a, b) => b.score - a.score || a.entry.localeCompare(b.entry));
  const top = matches[0]?.score ?? 0;
  return { subject: name, listVersion: opts.listVersion ?? DEMO_LIST_VERSION, status: classify(top), strong: top >= STRONG_MATCH_THRESHOLD, matches };
}

async function latestFor(ctx: QueryCtx | MutationCtx, vendorId: Id<"vendors">): Promise<Doc<"screenings"> | null> {
  const rows = await ctx.db.query("screenings").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
  rows.sort((a, b) => b.screenedAt - a.screenedAt || (b._creationTime - a._creationTime));
  return rows[0] ?? null;
}

/** Was this screening's automated status resolved by a reviewer? */
const isReviewed = (s: Doc<"screenings">) => s.status === "confirmed_match" || s.status === "false_positive";

/**
 * Screen one vendor and record the result. Idempotent per (vendor, listVersion): if the latest row
 * is for the same list version and the fresh result has the same automated status, the existing row
 * is returned (a reviewed row counts as its original status, so a false_positive is not re-opened by
 * re-running against the same list). A changed status, or a new list version, inserts a new row.
 */
export async function ensureScreened(ctx: MutationCtx, vendorId: Id<"vendors">): Promise<{ screeningId: Id<"screenings">; status: Doc<"screenings">["status"]; inserted: boolean }> {
  const vendor = await ctx.db.get(vendorId);
  if (!vendor) throw new ConvexError("vendor_not_found");
  const result = screenName(vendor.name);
  const latest = await latestFor(ctx, vendorId);
  if (latest && latest.listVersion === result.listVersion && latest.subject === result.subject) {
    const previousAutomated = latest.status === "clear" ? "clear" : "potential_match";
    if (previousAutomated === result.status) return { screeningId: latest._id, status: latest.status, inserted: false };
  }
  const t = await now(ctx);
  const screeningId = await ctx.db.insert("screenings", {
    vendorId,
    subject: result.subject,
    listVersion: result.listVersion,
    screenedAt: t,
    status: result.status,
    matches: result.matches,
  });
  const top = result.matches[0];
  // Payload carries no PII beyond the vendor's business name and the top hit (entry/program/score).
  await append(ctx, {
    actor: "system",
    type: "vendor_screened",
    payload: { screeningId, vendorId, vendorName: vendor.name, listVersion: result.listVersion, status: result.status, topScore: top?.score ?? null, topEntry: top?.entry ?? null, topProgram: top?.program ?? null, matchCount: result.matches.length },
  });
  return { screeningId, status: result.status, inserted: true };
}

export const screenVendor = mutation({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => ensureScreened(ctx, vendorId),
});

export const screenAll = mutation({
  args: {},
  handler: async (ctx) => {
    const vendors = await ctx.db.query("vendors").collect();
    let screened = 0;
    let potentialMatches = 0;
    for (const vnd of vendors) {
      const r = await ensureScreened(ctx, vnd._id);
      screened++;
      if (r.status === "potential_match" || r.status === "confirmed_match") potentialMatches++;
    }
    return { screened, potentialMatches, listVersion: DEMO_LIST_VERSION };
  },
});

/**
 * Human disposition of a potential match. Only approvers/admins (the same roles that decide payment
 * approvals). Marking a false positive requires a written reason so the audit trail explains why a
 * payment to a name that resembled a listed party was allowed to proceed.
 */
export const review = mutation({
  args: {
    screeningId: v.id("screenings"),
    decision: v.union(v.literal("false_positive"), v.literal("confirmed_match")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { screeningId, decision, note }) => {
    const op = await requireActor(ctx, ["approver", "admin"]);
    const s = await ctx.db.get(screeningId);
    if (!s) throw new ConvexError("screening_not_found");
    if (s.status === "clear") throw new ConvexError("screening_is_clear_nothing_to_review");
    if (isReviewed(s)) throw new ConvexError(`screening_already_${s.status}`);
    const trimmed = (note ?? "").trim();
    if (decision === "false_positive" && trimmed.length < 5) throw new ConvexError("false_positive_needs_a_note");
    const t = await now(ctx);
    await ctx.db.patch(screeningId, { status: decision, reviewedBy: op._id, reviewedAt: t, note: trimmed || undefined });
    const vendor = await ctx.db.get(s.vendorId);
    await append(ctx, {
      actor: "human",
      type: "screening_reviewed",
      payload: { screeningId, vendorId: s.vendorId, vendorName: vendor?.name ?? null, decision, reviewedBy: op.name, operatorId: op._id, note: trimmed || null, topScore: s.matches[0]?.score ?? null, listVersion: s.listVersion },
    });
    return decision;
  },
});

export const forVendor = query({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const rows = await ctx.db.query("screenings").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
    rows.sort((a, b) => b.screenedAt - a.screenedAt || (b._creationTime - a._creationTime));
    const history = [];
    for (const s of rows) {
      const reviewer = s.reviewedBy ? await ctx.db.get(s.reviewedBy) : null;
      history.push({ ...s, reviewedByName: reviewer?.name ?? null });
    }
    return { latest: history[0] ?? null, history };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const vendors = await ctx.db.query("vendors").collect();
    const all = await ctx.db.query("screenings").collect();
    const byVendor = new Map<Id<"vendors">, Doc<"screenings">>();
    for (const s of all) {
      const prev = byVendor.get(s.vendorId);
      if (!prev || s.screenedAt > prev.screenedAt || (s.screenedAt === prev.screenedAt && s._creationTime > prev._creationTime)) byVendor.set(s.vendorId, s);
    }
    let potentialMatches = 0;
    let confirmed = 0;
    let falsePositives = 0;
    let screenedVendors = 0;
    for (const vnd of vendors) {
      const s = byVendor.get(vnd._id);
      if (!s) continue;
      screenedVendors++;
      if (s.status === "potential_match") potentialMatches++;
      else if (s.status === "confirmed_match") confirmed++;
      else if (s.status === "false_positive") falsePositives++;
    }
    return { screenedVendors, unscreened: vendors.length - screenedVendors, potentialMatches, confirmed, falsePositives, listVersion: DEMO_LIST_VERSION, listSize: DEMO_WATCHLIST.length };
  },
});

/** Unresolved potential matches, oldest first, with the vendor name for the review queue. */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("screenings").withIndex("by_status", (q) => q.eq("status", "potential_match")).collect();
    rows.sort((a, b) => a.screenedAt - b.screenedAt);
    const out = [];
    for (const s of rows) {
      const vendor = await ctx.db.get(s.vendorId);
      out.push({ ...s, vendorName: vendor?.name ?? "?", vendorDomain: vendor?.domain ?? null, topScore: s.matches[0]?.score ?? 0 });
    }
    return out;
  },
});
