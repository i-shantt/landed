export type QueueCase = {
  _id: string;
  vendorName: string;
  state: string;
  amountAtStakeCents: number;
  openedAt: number;
};
export type QueueFilter =
  "all" | "attention" | "progress" | "ready" | "blocked" | "closed";
export type QueueSort = "priority" | "newest" | "amount";

export const isAttention = (state: string) =>
  ["RECOVERY", "UNCONFIRMED", "NEEDS_HUMAN"].includes(state);
export const isClosed = (state: string) => ["CLOSED", "LANDED"].includes(state);
export const isBlocked = (state: string) =>
  !isClosed(state) && !["VERIFIED", "PAID"].includes(state);
export function matchesQueueFilter(state: string, filter: QueueFilter) {
  if (filter === "ready") return state === "VERIFIED";
  if (filter === "attention") return isAttention(state);
  if (filter === "closed") return isClosed(state);
  if (filter === "blocked") return isBlocked(state);
  if (filter === "progress") return !isClosed(state) && !isAttention(state);
  return true;
}
const priority: Record<string, number> = {
  RECOVERY: 0,
  UNCONFIRMED: 1,
  NEEDS_HUMAN: 2,
  VERIFIED: 3,
  AWAITING_CONFIRMATION: 4,
  HELD: 5,
  PROBE_SENT: 6,
  PAID: 7,
  LANDED: 8,
  CLOSED: 9,
};
export function selectQueue<T extends QueueCase>(
  cases: readonly T[],
  query: string,
  filter: QueueFilter,
  sort: QueueSort,
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return cases
    .filter(
      (c) =>
        matchesQueueFilter(c.state, filter) &&
        (!needle ||
          `${c.vendorName} ${c._id}`.toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (sort === "amount")
        return (
          b.amountAtStakeCents - a.amountAtStakeCents || b.openedAt - a.openedAt
        );
      if (sort === "newest") return b.openedAt - a.openedAt;
      return (
        (priority[a.state] ?? 10) - (priority[b.state] ?? 10) ||
        b.openedAt - a.openedAt
      );
    });
}
export function nextCaseAction(state: string) {
  if (state === "RECOVERY") return "Open recovery";
  if (state === "NEEDS_HUMAN") return "Review case";
  if (state === "UNCONFIRMED") return "Check landing";
  if (state === "VERIFIED") return "Review payment";
  if (state === "PAID") return "Track payment";
  if (isClosed(state)) return "View record";
  return "View verification";
}

// ---- URL state and saved views ----
export type QueueSource = "all" | "live" | "demo";
export type QueueState = { query: string; filter: QueueFilter; sort: QueueSort; source: QueueSource };
export const QUEUE_DEFAULTS: QueueState = { query: "", filter: "all", sort: "priority", source: "all" };
const FILTERS: readonly QueueFilter[] = ["all", "attention", "progress", "ready", "blocked", "closed"];
const SORTS: readonly QueueSort[] = ["priority", "newest", "amount"];
const SOURCES: readonly QueueSource[] = ["all", "live", "demo"];

/** Read the queue state from `?q=&filter=&sort=&source=`; anything unknown falls back to the default. */
export function parseQueueParams(sp: { get(key: string): string | null }): QueueState {
  const pick = <V extends string>(key: string, allowed: readonly V[], d: V): V => {
    const v = sp.get(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as V) : d;
  };
  return {
    query: (sp.get("q") ?? "").slice(0, 200),
    filter: pick("filter", FILTERS, QUEUE_DEFAULTS.filter),
    sort: pick("sort", SORTS, QUEUE_DEFAULTS.sort),
    source: pick("source", SOURCES, QUEUE_DEFAULTS.source),
  };
}
/** The search string for a state: only non-default keys, in a stable order, so equal views give equal links. */
export function queueParamsToSearch(s: QueueState): string {
  const p = new URLSearchParams();
  if (s.query.trim()) p.set("q", s.query.trim());
  if (s.filter !== QUEUE_DEFAULTS.filter) p.set("filter", s.filter);
  if (s.sort !== QUEUE_DEFAULTS.sort) p.set("sort", s.sort);
  if (s.source !== QUEUE_DEFAULTS.source) p.set("source", s.source);
  return p.toString();
}
export type SavedView = { key: string; label: string; state: Partial<QueueState>; hint: string };
export const SAVED_VIEWS: readonly SavedView[] = [
  { key: "attention", label: "Needs attention", state: { filter: "attention", sort: "priority" }, hint: "recovery, unconfirmed landings and cases waiting on a person, most urgent first" },
  { key: "ready", label: "Ready to pay", state: { filter: "ready", sort: "amount" }, hint: "verified destinations with open invoices, largest first" },
  { key: "holds", label: "Largest holds", state: { filter: "blocked", sort: "amount" }, hint: "money the boundary is holding, largest first" },
  { key: "demo", label: "Demo cases", state: { source: "demo" }, hint: "the three seeded walkthrough cases" },
];
/** A saved view is active when every key it sets matches and every key it does not set is at its default (search excepted). */
export function isSavedViewActive(view: SavedView, s: QueueState): boolean {
  const keys: (keyof QueueState)[] = ["filter", "sort", "source"];
  return keys.every((k) => (k in view.state ? view.state[k] === s[k] : s[k] === QUEUE_DEFAULTS[k]));
}

// ---- bulk actions ----
// The same state sets `cases.requestHumanReview` and `cases.rejectChange` enforce on the server; the client only
// decides whether to offer the button. A mixed selection gets an action only when every selected case accepts it.
export const REVIEW_FROM: readonly string[] = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION"];
export const REJECT_FROM: readonly string[] = [...REVIEW_FROM, "NEEDS_HUMAN"];
export type BulkEligibility = { count: number; requestReview: boolean; rejectChange: boolean; reviewBlockedBy: number; rejectBlockedBy: number };
export function bulkEligibility(states: readonly string[]): BulkEligibility {
  const reviewBlockedBy = states.filter((s) => !REVIEW_FROM.includes(s)).length;
  const rejectBlockedBy = states.filter((s) => !REJECT_FROM.includes(s)).length;
  return {
    count: states.length,
    requestReview: states.length > 0 && reviewBlockedBy === 0,
    rejectChange: states.length > 0 && rejectBlockedBy === 0,
    reviewBlockedBy,
    rejectBlockedBy,
  };
}
export type BulkResult = { id: string; name: string; ok: boolean; error?: string };
/** One line for the status region after a bulk run: what succeeded, and which rows failed with the server's reason. */
export function summariseBulk(verb: string, results: readonly BulkResult[]): string {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const head = `${ok} of ${results.length} ${verb}`;
  if (failed.length === 0) return `${head}.`;
  return `${head}; ${failed.length} failed: ${failed.map((f) => `${f.name} (${f.error ?? "error"})`).join(", ")}.`;
}
