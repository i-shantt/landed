/** All wall-clock display in Landed is Pacific Time; the demo clock and timers are Pacific-anchored. */
export const DISPLAY_TZ = "America/Los_Angeles";

export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function absTime(t: number | null | undefined): string {
  if (!t) return "—";
  // hourCycle "h23" gives 00–23 without the midnight "24:xx" that hour12:false can produce.
  return new Date(t).toLocaleString("en-US", { timeZone: DISPLAY_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) + " PT";
}

export function absDate(t: number | null | undefined): string {
  if (!t) return "—";
  return new Date(t).toLocaleDateString("en-US", { timeZone: DISPLAY_TZ, month: "short", day: "numeric", year: "numeric" });
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

/** Offset (ms) of `tz` from UTC at the instant `epochMs`. */
function tzOffsetMs(epochMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * Parses a `datetime-local` value ("YYYY-MM-DDTHH:mm[:ss]") as Pacific wall-clock time and
 * returns epoch ms, regardless of the browser's own time zone. Returns undefined for blank or
 * malformed input. Two passes handle the DST transition hours.
 */
export function pacificLocalToEpoch(local: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const naive = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const first = naive - tzOffsetMs(naive, DISPLAY_TZ);
  return naive - tzOffsetMs(first, DISPLAY_TZ);
}
