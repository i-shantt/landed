"use client";
import { use } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/landed/primitives";
import { useCaseExport } from "@/lib/hooks";
import { absTime, usd } from "@/lib/format";
import { eventLabel, stateLabel, accountStatusLabel, channelLabel, rejectLabel, triggerLabel } from "@/lib/labels";

export default function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useCaseExport(id as Id<"cases">);
  if (data === undefined) return <Loading />;
  if (data === null) return <p className="text-sm text-red-700">Case not found.</p>;
  const acct = (a: { routing: string; last4: string; version: number; status: string } | null) => (a ? `routing ${a.routing} · account …${a.last4} · v${a.version} · ${accountStatusLabel(a.status)}` : "—");
  return (
    <div className="mx-auto max-w-3xl space-y-5 print:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-2 print:hidden">
        <h1 className="text-lg font-semibold">Case export</h1>
        <Button size="sm" onClick={() => window.print()}>Print</Button>
      </div>
      <header className="space-y-1 text-sm">
        <p className="text-base font-semibold">{data.company} · {data.vendor?.name} · {stateLabel(data.case.state)}</p>
        <p className="font-mono text-xs">case {data.case.id} · {triggerLabel(data.case.triggerType)} · opened {absTime(data.case.openedAt)}{data.case.closedAt ? ` · closed ${absTime(data.case.closedAt)}` : ""}</p>
        <p className="text-xs text-muted-foreground">Exported {absTime(data.exportedAt)}. Probe amounts are withheld; account numbers show the last four only.</p>
      </header>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Accounts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted-foreground">Requested</dt><dd className="font-mono text-xs">{acct(data.accounts.requested)}</dd>
          <dt className="text-muted-foreground">Prior</dt><dd className="font-mono text-xs">{acct(data.accounts.prior)}</dd>
        </dl>
      </section>

      {data.probe && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Probe deposit</h2>
          <p className="font-mono text-xs">state {data.probe.state} · submitted {absTime(data.probe.submittedAt)} · settled {absTime(data.probe.settledAt)} · available {absTime(data.probe.availableAt)} · ref {data.probe.railRef ?? "—"} · {data.probe.note}</p>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold">Confirmations</h2>
        {data.confirmations.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">When</th><th>Channel</th><th>Contact</th><th>Accepted</th><th>Used</th></tr></thead>
            <tbody>
              {data.confirmations.map((c, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 font-mono">{absTime(c.receivedAt)}</td>
                  <td>{channelLabel(c.channel)}{c.mode === "landing" ? " (landing)" : ""}</td>
                  <td>{c.contact ? `${c.contact.kind} · ${c.contact.trustLevel}` : "—"}</td>
                  <td>{c.accepted ? "yes" : `no — ${rejectLabel(c.rejectReason)}`}{c.mode === "landing" && typeof c.statedAmountCents === "number" ? ` · stated ${usd(c.statedAmountCents)}` : ""}</td>
                  <td>{c.usedAt ? absTime(c.usedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.payment && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Payment</h2>
          <p className="font-mono text-xs">{usd(data.payment.amountCents)} · {data.payment.rail.toUpperCase()} · sent {absTime(data.payment.sentAt)} by {data.payment.initiatedBy} · landing {data.payment.landingState} · deadline {absTime(data.payment.landingDeadlineAt)} · ref {data.payment.railRef ?? "—"}</p>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold">Timeline</h2>
        <ol className="space-y-0.5 text-xs">
          {data.timeline.map((e, i) => (
            <li key={i} className="grid grid-cols-[150px_60px_1fr] gap-2 border-t py-0.5">
              <span className="font-mono">{absTime(e.at)}</span>
              <span className="text-muted-foreground">{e.actor}</span>
              <span>{eventLabel(e.type)} <span className="text-muted-foreground">{JSON.stringify(e.payload)}</span></span>
            </li>
          ))}
        </ol>
      </section>

      {data.package && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Recovery package (generated {absTime(data.package.generatedAt)})</h2>
          <pre className="whitespace-pre-wrap rounded border bg-muted/30 p-3 text-xs">{data.package.markdown}</pre>
        </section>
      )}
    </div>
  );
}
