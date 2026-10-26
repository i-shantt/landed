"use client";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, ShieldAlert, Banknote, Hourglass, ClipboardCheck, Radar } from "lucide-react";
import { PageHeader, Section, StatCard, Loading } from "@/components/landed/primitives";
import { Sparkline, Bars, Donut, PALETTE } from "@/components/landed/charts";
import { RiskBadge, type RiskTier } from "@/components/landed/RiskPanel";
import { useOverview, useAttention, useRecentEvents } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { usd, absTime, relTime } from "@/lib/format";
import { stateLabel, eventLabel } from "@/lib/labels";

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

const TONE_RING: Record<string, string> = { red: "border-red-200 bg-red-50", amber: "border-amber-200 bg-amber-50", green: "border-emerald-200 bg-emerald-50" };

export default function DashboardPage() {
  const o = useOverview();
  const attention = useAttention();
  const recent = useRecentEvents();
  const { operator } = useOperator();

  if (o === undefined) return <Loading label="Loading overview…" />;
  const stateOrder = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "NEEDS_HUMAN", "VERIFIED", "PAID", "LANDED", "UNCONFIRMED", "RECOVERY", "CLOSED"];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Good ${new Date(o.now).getHours() < 12 ? "morning" : new Date(o.now).getHours() < 18 ? "afternoon" : "evening"}${operator ? `, ${operator.name.split(" ")[0]}` : ""}`}
        description={
          <>
            {o.cases.open} open verification case{o.cases.open === 1 ? "" : "s"}, {usd(o.money.amountHeldCents)} held until destinations are verified. Nothing on this page can release a payment.
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Held, awaiting verification" value={usd(o.money.amountHeldCents)} hint={`${o.money.heldInvoices} invoice${o.money.heldInvoices === 1 ? "" : "s"} re-pointed to unverified accounts`} tone={o.money.amountHeldCents > 0 ? "amber" : undefined} />
        <StatCard label="Protected from diversion" value={usd(o.money.fundsProtectedCents)} hint={`${o.money.attacksStopped} change request${o.money.attacksStopped === 1 ? "" : "s"} rejected or marked fraud`} tone="green" />
        <StatCard label="Needs a person" value={String(o.cases.needsHuman + o.controls.pendingApprovals + o.controls.unresolvedScreenings)} hint={`${o.cases.needsHuman} decisions · ${o.controls.pendingApprovals} approvals · ${o.controls.unresolvedScreenings} screening hits`} tone={o.cases.needsHuman + o.controls.pendingApprovals + o.controls.unresolvedScreenings > 0 ? "amber" : undefined} />
        <StatCard label="Median time to verify" value={fmtDuration(o.verification.medianTimeToVerifyMs)} hint={`${o.verification.verifiedByProbe} by probe read-back · ${o.verification.verifiedByException} exceptional · ${o.verification.falseReleases} false releases`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section
          title="Needs you"
          description="Decisions, approvals, screening hits and unconfirmed payments across the workspace, worst first."
          actions={
            <Link href="/cases?filter=attention" className="text-xs underline underline-offset-2">
              All cases
            </Link>
          }
        >
          {attention === undefined ? (
            <Loading />
          ) : attention.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-800">
              <ShieldCheck size={16} /> Nothing is waiting on a person.
            </p>
          ) : (
            <ul className="divide-y">
              {attention.map((it, i) => (
                <li key={`${it.kind}-${i}`}>
                  <Link href={it.href} className="flex items-start justify-between gap-3 py-2 hover:bg-slate-50">
                    <span className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border ${TONE_RING[it.tone]}`}>
                        {it.kind === "approval" ? <ClipboardCheck size={14} /> : it.kind === "screening" ? <Radar size={14} /> : it.kind === "landing" ? <Banknote size={14} /> : it.kind === "ready" ? <ShieldCheck size={14} /> : it.kind === "sla" ? <Hourglass size={14} /> : <ShieldAlert size={14} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{it.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{it.detail}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {relTime(it.at, o.now)} <ArrowUpRight size={12} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-4">
          <Section title="Cases opened, last 30 days" description={`${o.trend.reduce((s, d) => s + d.opened, 0)} opened · ${usd(o.trend.reduce((s, d) => s + d.heldCents, 0))} held at intake`}>
            <Sparkline values={o.trend.map((d) => d.opened)} />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{new Date(o.trend[0].day).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <span>today</span>
            </div>
          </Section>
          <Section title="Risk of open cases" description="Deterministic score from the stored request; informs people and policy only.">
            <Donut
              label="open cases"
              segments={[
                { label: "Low", value: o.risk.tiers.low, color: PALETTE[1] },
                { label: "Elevated", value: o.risk.tiers.elevated, color: PALETTE[3] },
                { label: "High", value: o.risk.tiers.high, color: "#d9823b" },
                { label: "Critical", value: o.risk.tiers.critical, color: PALETTE[4] },
              ]}
            />
            {o.risk.top.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {o.risk.top.slice(0, 3).map((r) => (
                  <li key={r.caseId} className="flex items-center justify-between">
                    <Link href={`/cases/${r.caseId}`} className="underline underline-offset-2">
                      Case …{String(r.caseId).slice(-6)}
                    </Link>
                    <RiskBadge score={r.score} tier={r.tier as RiskTier} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section title="Pipeline" description="Every case by state.">
          <Bars data={stateOrder.filter((s) => o.cases.byState[s]).map((s) => ({ label: stateLabel(s), value: o.cases.byState[s] }))} />
        </Section>
        <Section title="Payments" description="Only the payment boundary writes here.">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Sent</dt>
            <dd className="font-mono tabular-nums">
              {o.money.paidCount} · {usd(o.money.paidCents)}
            </dd>
            <dt className="text-xs text-muted-foreground">Landed</dt>
            <dd className="font-mono tabular-nums text-emerald-800">{o.money.landedCount}</dd>
            <dt className="text-xs text-muted-foreground">Awaiting landing</dt>
            <dd className="font-mono tabular-nums">{o.money.pendingLandingCount}</dd>
            <dt className="text-xs text-muted-foreground">Unconfirmed</dt>
            <dd className={`font-mono tabular-nums ${o.money.unconfirmedCount ? "text-red-800" : ""}`}>{o.money.unconfirmedCount}</dd>
            <dt className="text-xs text-muted-foreground">Open invoices</dt>
            <dd className="font-mono tabular-nums">{usd(o.money.openInvoicesCents)}</dd>
            <dt className="text-xs text-muted-foreground">SLA breaches</dt>
            <dd className={`font-mono tabular-nums ${o.cases.slaBreaches ? "text-amber-800" : ""}`}>{o.cases.slaBreaches}</dd>
          </dl>
          <Link href="/payments" className="mt-3 inline-flex items-center gap-1 text-xs underline underline-offset-2">
            Payments ledger <ArrowUpRight size={12} />
          </Link>
        </Section>
        <Section title="Controls" description="Vendor master hygiene and sign-offs.">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Vendors</dt>
            <dd className="font-mono tabular-nums">{o.controls.vendors}</dd>
            <dt className="text-xs text-muted-foreground">Unscreened</dt>
            <dd className={`font-mono tabular-nums ${o.controls.unscreenedVendors ? "text-amber-800" : ""}`}>{o.controls.unscreenedVendors}</dd>
            <dt className="text-xs text-muted-foreground">Screening hits open</dt>
            <dd className={`font-mono tabular-nums ${o.controls.unresolvedScreenings ? "text-red-800" : ""}`}>{o.controls.unresolvedScreenings}</dd>
            <dt className="text-xs text-muted-foreground">Approvals pending</dt>
            <dd className="font-mono tabular-nums">
              {o.controls.pendingApprovals}
              {o.controls.pendingApprovals ? ` · ${usd(o.controls.pendingApprovalCents)}` : ""}
            </dd>
          </dl>
          <div className="mt-3 flex gap-3 text-xs">
            <Link href="/controls" className="underline underline-offset-2">
              Policy
            </Link>
            <Link href="/approvals" className="underline underline-offset-2">
              Approvals
            </Link>
            <Link href="/compliance" className="underline underline-offset-2">
              Controls matrix
            </Link>
          </div>
        </Section>
      </div>

      <Section title="Recent activity" description="Latest audit events across all cases (append-only, probe amounts redacted).">
        {recent === undefined ? (
          <Loading />
        ) : (
          <ul className="divide-y text-xs">
            {recent.slice(0, 12).map((e) => (
              <li key={e._id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-slate-900">{eventLabel(e.type)}</span>
                  <span className="text-muted-foreground"> · {e.actor}</span>
                  {e.caseId && (
                    <Link href={`/cases/${e.caseId}`} className="ml-2 underline underline-offset-2">
                      case
                    </Link>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{absTime(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
