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
