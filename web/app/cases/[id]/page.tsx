"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaseStatusBadge } from "@/components/landed/badges";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import { CaseTimeline, type TimelineEvent } from "@/components/landed/CaseTimeline";
import { ProbeCard, AccountTable, ConfirmationList, PaymentCard } from "@/components/landed/CaseCards";
import { CaseActions, SimulateVendorAnswer } from "@/components/landed/CaseActions";
import { useCase, useCaseEvents, useProbe, useConfirmations, useNow } from "@/lib/hooks";
import { absTime, countdown } from "@/lib/format";
import { triggerLabel, humanReasonLabel, caseSummary } from "@/lib/labels";

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <CaseView caseId={id as Id<"cases">} />
    </Suspense>
  );
}

function CaseView({ caseId }: { caseId: Id<"cases"> }) {
  const sp = useSearchParams();
  const replay = sp.get("replay") === "1";
  const c = useCase(caseId);
  const live = useCaseEvents(caseId, !replay);
  const probe = useProbe(caseId);
  const confirmations = useConfirmations(caseId);
  const now = useNow();
  const [filter, setFilter] = useState("");

  if (c === undefined) return <Loading />;
  if (c === null) return <p className="text-sm text-red-700">Case not found.</p>;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <>
            {c.vendor ? <Link href={`/vendors/${c.vendor._id}`} className="hover:underline">{c.vendor.name}</Link> : "Unknown vendor"}
            <CaseStatusBadge state={c.state} />
            {replay && <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 text-[11px] text-indigo-900">Replay</span>}
          </>
        }
        description={
          <span>
            {triggerLabel(c.triggerType)} · opened <span className="font-mono tabular-nums">{absTime(c.openedAt)}</span>
            {c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt ? <> · SLA <span className="font-mono tabular-nums">{countdown(c.slaDeadlineAt, now)}</span></> : null}
          </span>
        }
        actions={
          replay ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/cases/${caseId}`} />}>Exit replay</Button>
          ) : (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/cases/${caseId}?replay=1`} />}>Replay timeline</Button>
          )
        }
      >
        <p className="max-w-3xl text-sm text-slate-800">{caseSummary(c.state, c.humanReason)}</p>
        {c.humanReason && c.state === "NEEDS_HUMAN" && (
          <p className="text-sm text-amber-900">Needs a human: <span className="font-medium">{humanReasonLabel(c.humanReason)}</span></p>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section
          title="Timeline"
          description="Append-only audit log. Probe amounts are redacted everywhere."
          actions={!replay ? <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter events…" aria-label="Filter timeline events" className="h-7 w-44 text-xs" /> : undefined}
        >
          {replay ? <ReplayTimeline caseId={caseId} now={now} /> : <CaseTimeline events={(live ?? []) as TimelineEvent[]} now={now} filter={filter} />}
        </Section>

        <div className="space-y-4">
          <AccountTable newAccount={c.newAccount} oldAccount={c.oldAccount} amountAtStakeCents={c.amountAtStakeCents} />
          <ProbeCard probe={probe} />
          <div className="rounded-md border bg-card px-4 py-2.5 text-xs text-slate-700">
            Validation provider: <span className="font-medium">{c.validationProviderResult === "no_coverage" ? "no coverage → probe" : c.validationProviderResult ?? "not consulted (escalated first)"}</span>
          </div>
          <PaymentCard payment={c.payment} now={now} />
          <ConfirmationList confirmations={confirmations} />
          {!replay && (
            <>
              <SimulateVendorAnswer caseId={caseId} state={c.state} />
              <CaseActions caseId={caseId} state={c.state} openInvoices={c.openInvoices} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Reads the events once, freezes them, and plays them back at 10x (no live subscription afterwards). */
function ReplayTimeline({ caseId, now }: { caseId: Id<"cases">; now: number }) {
  const live = useCaseEvents(caseId, true);
  if (!live) return <Loading label="Loading once…" />;
  return <ReplayPlayer events={live as TimelineEvent[]} now={now} />;
}

function ReplayPlayer({ events, now }: { events: TimelineEvent[]; now: number }) {
  const [frozen] = useState(events);
  const [run, setRun] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const timer = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(timer);
  }, [run]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const shown = reduced ? frozen.length : Math.min(tick, frozen.length);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{shown}/{frozen.length} events · 10x · offline (no live subscription)</span>
        <Button size="xs" variant="outline" onClick={() => { setTick(0); setRun((r) => r + 1); }}>Restart</Button>
      </div>
      <CaseTimeline events={frozen.slice(0, shown)} now={now} />
    </div>
  );
}
