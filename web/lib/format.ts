export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function absTime(t: number | null | undefined): string {
  if (!t) return "—";
  return new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " PT";
}

export function absDate(t: number | null | undefined): string {
  if (!t) return "—";
  return new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

/** Relative to the demo clock `now`. */
export function relTime(t: number | null | undefined, now: number): string {
  if (!t) return "—";
  const d = t - now;
  const abs = Math.abs(d);
  const sign = d < 0 ? "ago" : "from now";
  if (abs < 60_000) return "now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ${sign}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000 * 10) / 10}h ${sign}`;
  return `${Math.round(abs / 86_400_000 * 10) / 10}d ${sign}`;
}

export function countdown(deadline: number | null | undefined, now: number): string {
  if (!deadline) return "—";
  const d = deadline - now;
  if (d <= 0) return "expired";
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
