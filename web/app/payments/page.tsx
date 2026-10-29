"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { ReasonDialog } from "@/components/landed/ReasonDialog";
import { CaseStatusBadge } from "@/components/landed/badges";
import { usePaymentsDetailed, useAttestLanded } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { usd, absTime, countdown } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Id } from "@/convex/_generated/dataModel";

const LANDING_TONE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  landed: "border-emerald-200 bg-emerald-50 text-emerald-900",
  unconfirmed: "border-red-200 bg-red-50 text-red-900",
};

export default function PaymentsPage() {
  const rows = usePaymentsDetailed();
  const attest = useAttestLanded();
  const { operator } = useOperator();
  const now = useNow();
  const [attesting, setAttesting] = useState<Id<"payments"> | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "unconfirmed" | "landed">("all");

  if (rows === undefined) return <Loading />;
  const visible = rows.filter((p) => filter === "all" || p.landingState === filter);
  const sum = (s: string) => rows.filter((p) => p.landingState === s).reduce((n, p) => n + p.amountCents, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" description="Every payment the boundary has sent, with its landing status. A payment is not done until the vendor of record confirms it arrived." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting landing" value={usd(sum("pending"))} hint={`${rows.filter((p) => p.landingState === "pending").length} payment(s) inside the landing window`} tone={sum("pending") ? "amber" : undefined} />
        <StatCard label="Unconfirmed" value={usd(sum("unconfirmed"))} hint="deadline passed without a vendor confirmation" tone={sum("unconfirmed") ? "red" : undefined} />
        <StatCard label="Landed" value={usd(sum("landed"))} hint={`${rows.filter((p) => p.landingState === "landed").length} confirmed by the contact of record or attested`} tone="green" />
      </div>
      <Section
        title="Ledger"
        description="Newest first. Landing is confirmed by the vendor's contact of record (voice or portal) or attested by an operator."
        actions={
          <select aria-label="Filter payments" className="h-7 rounded-md border bg-white px-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All ({rows.length})</option>
            <option value="pending">Awaiting landing</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="landed">Landed</option>
          </select>
        }
      >
        {visible.length === 0 ? (
          <EmptyState title="No payments" description="Run the payment run to send verified invoices." action={{ label: "Open the payment run", href: "/payment-run" }} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3">Sent</th>
                  <th className="py-1 pr-3">Vendor</th>
                  <th className="py-1 pr-3">Invoice</th>
                  <th className="py-1 pr-3 text-right">Amount</th>
                  <th className="py-1 pr-3">Rail</th>
                  <th className="py-1 pr-3">Destination</th>
                  <th className="py-1 pr-3">Landing</th>
                  <th className="py-1 pr-3">Case</th>
                  <th className="py-1">By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((p) => (
                  <tr key={p._id}>
                    <td className="py-1.5 pr-3 font-mono text-xs tabular-nums">{absTime(p.sentAt)}</td>
                    <td className="py-1.5 pr-3">
                      <Link href={`/vendors/${p.vendorId}`} className="hover:underline">
                        {p.vendorName}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{p.invoiceNumber}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{usd(p.amountCents)}</td>
                    <td className="py-1.5 pr-3 text-xs uppercase">{p.rail}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{p.destination ? `${p.destination.routing} · …${p.destination.last4} · v${p.destination.version}` : "—"}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded border px-1.5 text-[11px] ${LANDING_TONE[p.landingState]}`}>{p.landingState === "pending" ? `awaiting · ${now ? countdown(p.landingDeadlineAt, now) : "…"}` : p.landingState}</span>
                      {p.landingState !== "landed" && operator && (
                        <button type="button" className="ml-2 text-xs underline underline-offset-2" onClick={() => setAttesting(p._id)}>
                          Attest landed
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {p.caseId ? (
                        <Link href={`/cases/${p.caseId}`}>
                          <CaseStatusBadge state={p.caseState ?? ""} showToken={false} />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">no case</span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">{p.initiatedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <ReasonDialog
        open={attesting !== null}
        onOpenChange={(o) => !o && setAttesting(null)}
        title="Attest that this payment landed"
        description="Use this when the vendor's contact of record confirmed receipt outside Landed (for example on a call you placed to the number on file). Your name and note go in the audit log."
        confirmLabel="Attest landed"
        onConfirm={async (note) => {
          if (!operator || !attesting) return;
          await attest({ paymentId: attesting, note });
        }}
      />
      <p className="text-xs text-muted-foreground">
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" nativeButton={false} render={<Link href="/payment-files" />}>
          Payment files (NACHA, ISO 20022)
        </Button>
      </p>
    </div>
  );
}
