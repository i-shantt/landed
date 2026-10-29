// Risk trend: per-day aggregates over the last 7 or 30 local days (company timezone). Pure.

export type TrendRow = { at: number; flagged: boolean; flagScore: number; amountCents: number };
export type TrendDay = { date: string; payments: number; flagged: number; avgRisk: number | null; sentCents: number; heldCents: number };

/** Local calendar date "YYYY-MM-DD" of a timestamp in a timezone (falls back to UTC). */
export function localDate(t: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

export function buildTrend(args: { now: number; days: 7 | 30; timezone: string; rows: TrendRow[]; heldByDay?: Record<string, number> }): TrendDay[] {
  const DAY = 86_400_000;
  const dates: string[] = [];
  for (let i = args.days - 1; i >= 0; i--) dates.push(localDate(args.now - i * DAY, args.timezone));
  const byDate = new Map<string, { payments: number; flagged: number; riskSum: number; sentCents: number }>();
  for (const d of dates) byDate.set(d, { payments: 0, flagged: 0, riskSum: 0, sentCents: 0 });
  for (const r of args.rows) {
    const b = byDate.get(localDate(r.at, args.timezone));
    if (!b) continue;
    b.payments++;
    if (r.flagged) b.flagged++;
    b.riskSum += r.flagScore;
    b.sentCents += r.amountCents;
  }
  return dates.map((date) => {
    const b = byDate.get(date)!;
    return { date, payments: b.payments, flagged: b.flagged, avgRisk: b.payments ? Math.round(b.riskSum / b.payments) : null, sentCents: b.sentCents, heldCents: args.heldByDay?.[date] ?? 0 };
  });
}
