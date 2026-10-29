"use client";
import { useState } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { ReasonDialog, errorMessage } from "@/components/landed/ReasonDialog";
import { RiskBadge, type RiskTier } from "@/components/landed/RiskPanel";
import { useApprovals, useApprovalActions, usePolicy } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { usd, absTime } from "@/lib/format";
import { refusalLabel } from "@/lib/labels";
import type { Id } from "@/convex/_generated/dataModel";

function tierFor(score: number): RiskTier {
  return score >= 70 ? "critical" : score >= 45 ? "high" : score >= 20 ? "elevated" : "low";
}

const STATUS_TONE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-900",
  consumed: "border-slate-200 bg-slate-50 text-slate-700",
  rejected: "border-red-200 bg-red-50 text-red-900",
};

export default function ApprovalsPage() {
  const all = useApprovals();
  const policy = usePolicy();
  const { decide } = useApprovalActions();
  const { operator, canApprove } = useOperator();
  const [rejecting, setRejecting] = useState<Id<"approvals"> | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  const pending = (all ?? []).filter((a) => a.status === "pending");
  const history = (all ?? []).filter((a) => a.status !== "pending");
  const controlsOn = policy && (policy.dualApprovalAboveCents !== null || policy.riskReviewAbove !== null);

  async function approve(id: Id<"approvals">) {
    if (!operator) return;
    try {
      await decide({ approvalId: id, decision: "approved" });
      setMsg((m) => ({ ...m, [id]: "Approved. The payment run can now send this line." }));
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: errorMessage(e) }));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        description={
          <>
            Maker-checker release. A clerk requests, a different approver decides; <code className="font-mono text-xs">payments.send</code> consumes the approval when the money goes out.
            {policy && !controlsOn ? (
              <>
                {" "}
                No approval thresholds are on. <Link href="/controls" className="underline underline-offset-2">Turn on controls</Link>.
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting decision" value={String(pending.length)} tone={pending.length ? "amber" : undefined} hint={usd(pending.reduce((s, a) => s + a.amountCents, 0)) + " held for sign-off"} />
        <StatCard label="Dual-approval threshold" value={policy ? (policy.dualApprovalAboveCents === null ? "off" : usd(policy.dualApprovalAboveCents)) : "…"} hint="payments at or above this need a second approver" />
        <StatCard label="Risk review threshold" value={policy ? (policy.riskReviewAbove === null ? "off" : `${policy.riskReviewAbove}/100`) : "…"} hint="cases scoring at or above this need sign-off" />
      </div>

      <Section title="Pending" description={canApprove ? `You are signed in as ${operator?.name}, who may approve. You cannot approve your own requests.` : `You are signed in as ${operator?.name ?? "nobody"}, who cannot approve. Only an approver or administrator can decide.`}>
        {all === undefined ? (
          <Loading />
        ) : pending.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Requests appear here when a payment-run line needs a second approver or a risk review." action={{ label: "Open the payment run", href: "/payment-run" }} />
        ) : (
          <ul className="divide-y">
            {pending.map((a) => {
              const own = a.requestedBy === operator?._id;
              return (
                <li key={a._id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-slate-900">{a.vendorName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{a.invoiceNumber}</span>
                      <span className="font-mono text-sm tabular-nums">{usd(a.amountCents)}</span>
                      {a.riskScore !== undefined && <RiskBadge score={a.riskScore} tier={tierFor(a.riskScore)} />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Requested by {a.requestedByName} · {absTime(a.requestedAt)} · destination {a.destination ? `${a.destination.routing} · …${a.destination.last4} (${a.destination.status})` : "missing"}
                    </div>
                    <ul className="text-xs text-slate-700">
                      {a.requiredBy.map((r) => (
                        <li key={r}>• {refusalLabel(r)}</li>
                      ))}
                    </ul>
                    {a.note && <p className="text-xs italic text-slate-700">“{a.note}”</p>}
                    {msg[a._id] && (
                      <p className="text-xs" role="status">
                        {msg[a._id]}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" disabled={!canApprove || own} onClick={() => setRejecting(a._id)}>
                      Reject
                    </Button>
                    <Button size="sm" disabled={!canApprove || own} title={own ? "You requested this; a different approver must decide." : undefined} onClick={() => approve(a._id)}>
                      <ClipboardCheck size={14} /> Approve
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="History" description="Every decision is also in the audit log with the operator's name.">
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Vendor</th>
                <th className="py-1 pr-3">Invoice</th>
                <th className="py-1 pr-3 text-right">Amount</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Requested by</th>
                <th className="py-1 pr-3">Decided by</th>
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.map((a) => (
                <tr key={a._id}>
                  <td className="py-1.5 pr-3">{a.vendorName}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{a.invoiceNumber}</td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{usd(a.amountCents)}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`rounded border px-1.5 text-[11px] ${STATUS_TONE[a.status]}`}>{a.status}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-xs">{a.requestedByName}</td>
                  <td className="py-1.5 pr-3 text-xs">
                    {a.decidedByName ?? "—"}
                    {a.decidedAt ? <span className="block text-muted-foreground">{absTime(a.decidedAt)}</span> : null}
                  </td>
                  <td className="py-1.5 text-xs text-slate-700">{a.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Reject this payment approval?"
        description="The payment stays blocked. Your note is recorded in the audit log."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          if (!operator || !rejecting) return;
          await decide({ approvalId: rejecting, decision: "rejected", note: reason });
        }}
      />
    </div>
  );
}
