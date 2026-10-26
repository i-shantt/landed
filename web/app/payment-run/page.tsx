"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageHeader,
  StatCard,
  EmptyState,
  Loading,
} from "@/components/landed/primitives";
import {
  AccountStatusBadge,
  CaseStatusBadge,
} from "@/components/landed/badges";
import { usePaymentRun, useSendPayment, useApprovalActions } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { usd, absDate } from "@/lib/format";
import { refusalLabel } from "@/lib/labels";
import { errorMessage } from "@/components/landed/ReasonDialog";
import type { Id } from "@/convex/_generated/dataModel";

type LineResult = {
  kind: "paid" | "duplicate" | "refused" | "error";
  text: string;
};
type SentLine = { invoiceId: string; number: string; vendorName: string; amountCents: number; paymentId: string; at: number };

export default function PaymentRunPage() {
  const run = usePaymentRun();
  const send = useSendPayment();
  const { request } = useApprovalActions();
  const { operator } = useOperator();
  const [sent, setSent] = useState<SentLine[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, LineResult>>({});

  if (run === undefined) return <Loading />;
  const payable = run.lines.filter((l) => l.decision.ok && (l.policy === null || l.policy.ok));
  const needsApproval = run.lines.filter((l) => l.decision.ok && l.policy !== null && !l.policy.ok);
  const lineKind = (l: (typeof run.lines)[number]) => (!l.decision.ok ? "blocked" : l.policy && !l.policy.ok ? "approval" : "payable");
  const visibleLines = run.lines.filter(
    (l) =>
      (!query.trim() ||
        `${l.number} ${l.vendorName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())) &&
      (view === "all" || lineKind(l) === view),
  );

  async function requestApproval(invoiceId: Id<"invoices">) {
    if (!operator) return;
    try {
      await request({ invoiceId, operatorId: operator._id });
      setResults((prev) => ({ ...prev, [invoiceId]: { kind: "duplicate", text: `approval requested by ${operator.name}; see Approvals` } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [invoiceId]: { kind: "error", text: errorMessage(e) } }));
    }
  }

  async function runPayable() {
    setConfirm(false);
    setBusy(true);
    // Snapshot the payable set now; each line is re-evaluated by the server on send.
    const snapshot = payable.map((l) => ({ invoiceId: l.invoiceId, number: l.number, vendorName: l.vendorName, amountCents: l.amountCents }));
    for (const line of snapshot) {
      const invoiceId = line.invoiceId;
      try {
        const r = await send({
          invoiceId,
          initiatedBy: operator ? `${operator.name} (payment run)` : "payment-run",
          rail: "ach",
        });
        if (r.ok && !r.duplicate) setSent((prev) => [{ ...line, paymentId: r.paymentId as string, at: Date.now() }, ...prev]);
        setResults((prev) => ({
          ...prev,
          [invoiceId]: r.ok
            ? {
                kind: r.duplicate ? "duplicate" : "paid",
                text: r.duplicate
                  ? `already paid earlier (${r.paymentId})`
                  : `paid · ${r.paymentId}`,
              }
            : {
                kind: "refused",
                text: `${refusalLabel(r.reason)} (${r.reason})`,
              },
        }));
      } catch (e) {
        setResults((prev) => ({
          ...prev,
          [invoiceId]: { kind: "error", text: errorMessage(e) },
        }));
      }
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment run"
        actions={
          <Button
            disabled={busy || payable.length === 0}
            onClick={() => setConfirm(true)}
          >
            {busy ? "Running…" : `Run payable (${payable.length})`}
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Payable"
          value={usd(run.totals.payableCents)}
          hint={`${run.totals.payable} invoice${run.totals.payable === 1 ? "" : "s"} to verified, current-version accounts`}
          tone={run.totals.payable > 0 ? "green" : undefined}
        />
        <StatCard
          label="Needs approval"
          value={usd(run.totals.needsApprovalCents)}
          hint={`${run.totals.needsApproval} verified line${run.totals.needsApproval === 1 ? "" : "s"} held by company policy`}
          tone={run.totals.needsApproval > 0 ? "amber" : undefined}
        />
        <StatCard
          label="Blocked"
          value={usd(run.totals.blockedCents)}
          hint={`${run.totals.blocked} invoice${run.totals.blocked === 1 ? "" : "s"} refused by the guard`}
          tone={run.totals.blocked > 0 ? "red" : undefined}
        />
      </div>
      {run.lines.length === 0 ? (
        <EmptyState
          title="No open invoices"
          description="Every invoice is paid. Send a bank-change email from the Mailbox or re-seed to get a batch."
          action={{ label: "Open the Mailbox", href: "/mailbox" }}
        />
      ) : (
        <section className="ops-queue" aria-label="Payment run invoices">
          <div className="ops-toolbar">
            <div className="ops-search-field">
              <Search size={15} />
              <input
                aria-label="Search payment run"
                placeholder="Search invoices or vendors"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="ops-toolbar-selects">
              <select
                aria-label="Filter payment run"
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                <option value="all">All invoices ({run.lines.length})</option>
                <option value="blocked">
                  Blocked ({run.totals.blocked})
                </option>
                <option value="approval">Needs approval ({needsApproval.length})</option>
                <option value="payable">Payable ({payable.length})</option>
              </select>
            </div>
          </div>
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLines.map((l) => {
                const res = results[l.invoiceId as string];
                return (
                  <TableRow key={l.invoiceId}>
                    <TableCell className="font-mono text-xs">
                      {l.number}
                    </TableCell>
                    <TableCell className="text-sm">{l.vendorName}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {usd(l.amountCents)}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {absDate(l.dueAt)}
                    </TableCell>
                    <TableCell>
                      {l.destination ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs tabular-nums">
                            {l.destination.routing} · …{l.destination.last4} · v
                            {l.destination.version}
                          </span>
                          <AccountStatusBadge status={l.destination.status} />
                        </span>
                      ) : (
                        <span className="text-xs text-red-800">missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.decision.ok && l.policy && !l.policy.ok ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-xs text-amber-900" title={refusalLabel(l.policy.reason)}>
                            {l.policy.reason === "policy_approval_required" || l.policy.reason === "policy_risk_review_required" ? "needs approval" : l.policy.reason.replace("policy_", "").replaceAll("_", " ")}
                          </span>
                          {(l.policy.reason === "policy_approval_required" || l.policy.reason === "policy_risk_review_required") && (
                            <button type="button" className="text-xs underline underline-offset-2" onClick={() => requestApproval(l.invoiceId)}>
                              Request approval
                            </button>
                          )}
                        </span>
                      ) : l.decision.ok ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-xs text-emerald-900">
                          payable
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-red-200 bg-red-50 px-1.5 text-xs text-red-900">
                            {refusalLabel(l.decision.reason)}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.caseId ? (
                        <Link
                          href={`/cases/${l.caseId}`}
                          className="inline-flex items-center gap-1.5 text-xs underline"
                        >
                          <CaseStatusBadge
                            state={l.caseState ?? ""}
                            showToken={false}
                          />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {res ? (
                        <span
                          className={
                            res.kind === "paid"
                              ? "text-emerald-800"
                              : res.kind === "duplicate"
                                ? "text-slate-700"
                                : "text-red-800"
                          }
                        >
                          {res.text}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!visibleLines.length && (
            <div className="ops-no-results">
              <h2>No matching invoices</h2>
              <button
                type="button"
                className="ops-button"
                onClick={() => {
                  setQuery("");
                  setView("all");
                }}
              >
                Reset filters
              </button>
            </div>
          )}
          <footer className="ops-table-footer">
            <span>
              {visibleLines.length} of {run.lines.length} invoices
            </span>
            <span>Destinations checked before release</span>
          </footer>
        </section>
      )}
      {sent.length > 0 && (
        <section className="rounded-md border border-emerald-200 bg-emerald-50/40" aria-label="Sent this session">
          <header className="border-b border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-900">
            Sent this session · {sent.length} payment{sent.length === 1 ? "" : "s"} · {usd(sent.reduce((n, l) => n + l.amountCents, 0))}
          </header>
          <ul className="divide-y divide-emerald-100 text-xs">
            {sent.map((l) => (
              <li key={l.paymentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
                <span>
                  <span className="font-mono">{l.number}</span> · {l.vendorName}
                </span>
                <span className="font-mono tabular-nums">{usd(l.amountCents)}</span>
                <span className="font-mono text-muted-foreground">payment {l.paymentId.slice(-8)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Run {payable.length} payable invoice
              {payable.length === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              {usd(run.totals.payableCents)} to verified accounts, sent one by
              one by <code className="font-mono">payments.send</code> as {operator?.name ?? "payment-run"}. Blocked lines and
              lines awaiting approval are never sent; the server re-checks every line as it goes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={runPayable}>Run payable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
