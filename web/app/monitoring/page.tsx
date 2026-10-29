"use client";
import { useState } from "react";
import Link from "next/link";
import { PageHeader, Section, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { Sparkline } from "@/components/landed/charts";
import { TrustBadge, TrustComponents } from "@/components/landed/TrustBadge";
import { ModelBadge } from "@/components/landed/ModelPanel";
import { useMonitoring } from "@/lib/hooks";
import { usd, absTime } from "@/lib/format";

const LANDING_TONE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  landed: "border-emerald-200 bg-emerald-50 text-emerald-900",
  unconfirmed: "border-red-200 bg-red-50 text-red-900",
};

function FlagScore({ score, flagged }: { score: number; flagged: boolean }) {
  return (
    <span className={`inline-flex h-6 items-center rounded border px-1.5 font-mono text-[11px] tabular-nums ${flagged ? "border-orange-200 bg-orange-50 text-orange-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} title={flagged ? "At or above the flag threshold (40)" : "Below the flag threshold (40)"}>
      {score}
    </span>
  );
}

export default function MonitoringPage() {
  const m = useMonitoring();
  const [openTrust, setOpenTrust] = useState<string | null>(null);
  const [view, setView] = useState<"flagged" | "recent">("flagged");
  if (m === undefined) return <Loading label="Scoring payments against each vendor's history…" />;
  const rows = view === "flagged" ? m.flagged : m.recent;
  const flaggedDays = m.trend30.map((d) => d.flagged);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction monitoring"
        description="Every sent payment scored against its vendor's own history, with the world as it was when it was sent. Thresholds adapt to the vendor (median, spread, weekly cadence) and are computed on read. Monitoring informs people and policy; it cannot release or block a payment on its own."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Flagged, last 7 days" value={String(m.stats.flagged7d)} hint={`${m.stats.flagged} flagged of ${m.stats.scored} scored overall`} tone={m.stats.flagged7d > 0 ? "amber" : undefined} />
        <StatCard label="Average flag score, 7 days" value={m.stats.avgFlagScore7d === null ? "—" : `${m.stats.avgFlagScore7d}/100`} hint="Sum of fired signal weights; 40 flags" />
        <StatCard label="Sent, last 7 days" value={usd(m.stats.sent7dCents)} hint={`${m.recent.filter((r) => r.sentAt >= m.now - 7 * 86_400_000).length} payments`} />
        <StatCard label="Review threshold" value={m.reviewAbove === null || m.reviewAbove === undefined ? "off" : `≥ ${m.reviewAbove}`} hint={m.reviewAbove === null || m.reviewAbove === undefined ? "Turn on in Controls to require an approval above a score" : "Payments at or above this need an approval"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Section
          title={view === "flagged" ? "Flagged payments" : "Recent payments"}
          description={view === "flagged" ? "Payments whose signals summed to 40 or more. Each signal carries the evidence it was computed from." : "The last 20 payments with their scores."}
          actions={
            <select aria-label="Which payments" className="h-7 rounded-md border bg-white px-2 text-xs" value={view} onChange={(e) => setView(e.target.value as typeof view)}>
              <option value="flagged">Flagged ({m.flagged.length})</option>
              <option value="recent">Recent</option>
            </select>
          }
        >
          {rows.length === 0 ? (
            <EmptyState title={view === "flagged" ? "Nothing flagged" : "No payments yet"} description={view === "flagged" ? "No sent payment stands out against its vendor's history." : "Run the payment run to send verified invoices."} action={{ label: "Open the payment run", href: "/payment-run" }} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Sent</th>
                    <th className="py-1 pr-3">Vendor</th>
                    <th className="py-1 pr-3">Invoice</th>
                    <th className="py-1 pr-3 text-right">Amount</th>
                    <th className="py-1 pr-3">Score</th>
                    <th className="py-1 pr-3">Model</th>
                    <th className="py-1 pr-3">Signals</th>
                    <th className="py-1">Landing</th>
                  </tr>
                </thead>
                <tbody className="divide-y align-top">
                  {rows.map((r) => (
                    <tr key={r.paymentId}>
                      <td className="py-1.5 pr-3 font-mono text-xs tabular-nums">{absTime(r.sentAt)}</td>
                      <td className="py-1.5 pr-3">
                        <Link href={`/vendors/${r.vendorId}`} className="hover:underline">{r.vendorName}</Link>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{r.invoiceNumber}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{usd(r.amountCents)}</td>
                      <td className="py-1.5 pr-3"><FlagScore score={r.monitoring.flagScore} flagged={r.monitoring.flagged} /></td>
                      <td className="py-1.5 pr-3">{r.modelProbability === null ? <span className="text-xs text-muted-foreground">—</span> : <ModelBadge risk={{ version: r.modelVersion ?? "", probability: r.modelProbability, score: Math.round(100 * r.modelProbability), flagged: false, threshold: 0, contributions: [] }} />}</td>
                      <td className="py-1.5 pr-3">
                        {r.monitoring.signals.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{r.monitoring.checked.length} checks clear</span>
                        ) : (
                          <ul className="space-y-0.5 text-xs">
                            {r.monitoring.signals.map((s) => (
                              <li key={s.id} title={s.evidence}>
                                <span className="font-medium text-slate-900">{s.title}</span> <span className="font-mono text-[10px] text-muted-foreground">+{s.weight}</span>
                                <div className="text-[11px] text-muted-foreground">{s.evidence}</div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="py-1.5">
                        <span className={`rounded border px-1.5 text-[11px] ${LANDING_TONE[r.landingState]}`}>{r.landingState}</span>
                        {r.caseId && (
                          <Link href={`/cases/${r.caseId}`} className="ml-2 text-xs underline underline-offset-2">case</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="space-y-4">
          <Section title="Flagged per day, last 30 days" description={`${flaggedDays.reduce((s, x) => s + x, 0)} flagged · ${usd(m.trend30.reduce((s, d) => s + d.heldCents, 0))} held at case intake`}>
            <Sparkline values={flaggedDays} stroke="#b45309" />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{m.trend30[0]?.date}</span>
              <span>today</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Also served as <span className="font-mono">GET /api/v1/risk/trend?window=7d|30d</span>.
            </p>
          </Section>
          <Section title="Beneficiary trust" description="0–100 from tenure, landed payments, bank-change recency, screening, the learned model and open cases. Lowest first.">
            <ul className="divide-y text-sm">
              {m.trust.map((t) => (
                <li key={t.vendorId} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/vendors/${t.vendorId}`} className="truncate hover:underline">{t.vendorName}</Link>
                    <button type="button" className="shrink-0" onClick={() => setOpenTrust(openTrust === t.vendorId ? null : t.vendorId)} aria-expanded={openTrust === t.vendorId}>
                      <TrustBadge score={t.score} band={t.band} />
                    </button>
                  </div>
                  {openTrust === t.vendorId && <TrustComponents components={t.components} />}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
