"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBadge, AccountStatusBadge } from "@/components/state-badge";
import { TrustBadge } from "@/components/trust-badge";
import { Timeline, type TimelineEvent } from "@/components/timeline";
import { CaseActions, SimulateVendorAnswer } from "@/components/case-actions";
import { useNow } from "@/components/clock-display";
import { usd, absTime, countdown } from "@/lib/format";
import { TRIGGER_LABELS, humanReasonLabel, rejectLabel } from "@/lib/labels";

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <CaseView caseId={id as Id<"cases">} />
    </Suspense>
  );
}

function CaseView({ caseId }: { caseId: Id<"cases"> }) {
  const sp = useSearchParams();
  const replay = sp.get("replay") === "1";
  const c = useQuery(api.cases.get, { caseId });
  const live = useQuery(api.events.listForCase, replay ? "skip" : { caseId });
  const probe = useQuery(api.probes.getPublic, { caseId });
  const confirmations = useQuery(api.confirmations.listForCase, { caseId });
  const now = useNow();

  if (c === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (c === null) return <p className="text-sm text-red-700">Case not found.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">
              {c.vendor ? (
                <Link href={`/vendors/${c.vendor._id}`} className="hover:underline">
                  {c.vendor.name}
                </Link>
              ) : (
                "Unknown vendor"
              )}
            </h1>
            <StateBadge state={c.state} />
            {replay && <Badge className="bg-indigo-100 text-indigo-900 border-indigo-200" variant="outline">Replay</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {TRIGGER_LABELS[c.triggerType] ?? c.triggerType} · opened {absTime(c.openedAt)}
            {c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt ? ` · SLA ${countdown(c.slaDeadlineAt, now)}` : ""}
          </p>
          <p className="text-sm">
            Validation provider: <span className="font-medium">{c.validationProviderResult === "no_coverage" ? "no coverage → probe." : c.validationProviderResult ?? "not consulted (escalated first)"}</span>
          </p>
          {c.humanReason && (
            <p className="text-sm text-amber-900">
              Needs a human: <span className="font-medium">{humanReasonLabel(c.humanReason)}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!replay ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/cases/${caseId}?replay=1`} />}>
              Replay timeline
            </Button>
          ) : (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/cases/${caseId}`} />}>
              Exit replay
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
            <CardDescription>Append-only audit log. Probe amounts are redacted everywhere.</CardDescription>
          </CardHeader>
          <CardContent>{replay ? <ReplayTimeline caseId={caseId} /> : <Timeline events={(live ?? []) as TimelineEvent[]} />}</CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Destination account</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              {c.newAccount ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{c.newAccount.routing} · …{c.newAccount.accountLast4}</span>
                    <AccountStatusBadge status={c.newAccount.status} />
                    <span className="text-xs text-muted-foreground">v{c.newAccount.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">created via {c.newAccount.createdVia}</div>
                </>
              ) : (
                "—"
              )}
              {c.oldAccount && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-xs text-muted-foreground">Replaces</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{c.oldAccount.routing} · …{c.oldAccount.accountLast4}</span>
                    <AccountStatusBadge status={c.oldAccount.status} />
                  </div>
                </div>
              )}
              <div className="pt-2 border-t mt-2">
                <div className="text-xs text-muted-foreground">Amount at stake</div>
                <div className="font-mono">{usd(c.amountAtStakeCents)}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Probe deposit</CardTitle>
              <CardDescription>Randomized sub-dollar credit, memo ACCTVERIFY. The amount is never shown.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {probe ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">State</dt>
                  <dd>
                    <Badge variant="outline">{probe.state}</Badge>
                  </dd>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd className="font-mono text-xs">{absTime(probe.submittedAt)}</dd>
                  <dt className="text-muted-foreground">Settled</dt>
                  <dd className="font-mono text-xs">{absTime(probe.settledAt)}</dd>
                  <dt className="text-muted-foreground">Available</dt>
                  <dd className="font-mono text-xs">{absTime(probe.availableAt)}</dd>
                  <dt className="text-muted-foreground">Rail ref</dt>
                  <dd className="font-mono text-xs break-all">{probe.railRef ?? "pending"}</dd>
                </dl>
              ) : (
                <p className="text-muted-foreground">No probe (case escalated before a probe was sent).</p>
              )}
            </CardContent>
          </Card>

          {c.payment && (
            <Card>
              <CardHeader>
                <CardTitle>Payment</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="font-mono">{usd(c.payment.amountCents)} · {c.payment.rail.toUpperCase()}</div>
                <div>
                  landing: <Badge variant="outline">{c.payment.landingState}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">sent {absTime(c.payment.sentAt)} by {c.payment.initiatedBy}</div>
                <div className="text-xs text-muted-foreground">landing deadline {absTime(c.payment.landingDeadlineAt)}</div>
                <div className="font-mono text-xs break-all">{c.payment.railRef ?? "rail ref pending"}</div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirmations</CardTitle>
          <CardDescription>Every stated amount that reached us, accepted or not. Only a bound, accepted statement from the contact of record can verify.</CardDescription>
        </CardHeader>
        <CardContent>
          {!confirmations || confirmations.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {confirmations.map((k) => (
                <li key={k._id} className="flex flex-wrap items-center gap-2 border rounded-md px-3 py-2">
                  <Badge variant="outline">{k.channel}</Badge>
                  {k.mode === "landing" && <Badge variant="outline">landing</Badge>}
                  <Badge variant="outline" className={k.accepted ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"}>
                    {k.accepted ? "accepted by channel" : "not accepted"}
                  </Badge>
                  {k.usedAt && <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">used to verify</Badge>}
                  {k.contact && <TrustBadge level={k.contact.trustLevel} superseded={!!k.contact.supersededAt} />}
                  <span className="text-xs text-muted-foreground font-mono">{absTime(k.receivedAt)}</span>
                  <span className="text-xs">{k.hasStatedAmount ? (k.mode === "landing" && k.statedAmountCents !== undefined ? `stated ${usd(k.statedAmountCents)}` : "stated an amount (hidden)") : "stated: nothing arrived"}</span>
                  {k.rejectReason && <span className="text-xs text-red-700">{rejectLabel(k.rejectReason)}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!replay && (
        <>
          <SimulateVendorAnswer caseId={caseId} state={c.state} />
          <CaseActions caseId={caseId} state={c.state} openInvoices={c.openInvoices} />
        </>
      )}
    </div>
  );
}

/** Reads the events once, freezes them, and plays them back at 10x (no live subscription afterwards). */
function ReplayTimeline({ caseId }: { caseId: Id<"cases"> }) {
  const live = useQuery(api.events.listForCase, { caseId });
  if (!live) return <p className="text-sm text-muted-foreground">Loading once…</p>;
  // Mounting the player with the first snapshot freezes it: ReplayPlayer never re-reads `events`.
  return <ReplayPlayer events={live as TimelineEvent[]} />;
}

function ReplayPlayer({ events }: { events: TimelineEvent[] }) {
  const [frozen] = useState(events); // captured once; later live updates are ignored
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setShown(Math.min(i, frozen.length));
      if (i >= frozen.length) clearInterval(timer);
    }, 300);
    return () => clearInterval(timer);
  }, [frozen, run]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {shown}/{frozen.length} events · 10x · offline (no live subscription)
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setShown(0);
            setRun((r) => r + 1);
          }}
        >
          Restart
        </Button>
      </div>
      <Timeline events={frozen.slice(0, shown)} />
    </div>
  );
}
