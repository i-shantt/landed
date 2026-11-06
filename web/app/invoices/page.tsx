"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { AccountStatusBadge, CaseStatusBadge, InvoiceStatusBadge } from "@/components/landed/badges";
import { useInvoices, useNow, usePaymentRun } from "@/lib/hooks";
import { usd, absDate } from "@/lib/format";
import { refusalLabel } from "@/lib/labels";
import { toCsv, downloadText } from "@/lib/csv";
import { cn } from "@/lib/utils";

type Row = NonNullable<ReturnType<typeof useInvoices>>[number];
type StatusFilter = "all" | "open" | "held" | "paid" | "overdue";
type Sort = "due" | "amount" | "vendor";

const APPROVAL_REASONS = new Set(["policy_approval_required", "policy_risk_review_required", "policy_monitoring_review_required"]);

export default function InvoicesPage() {
  const rows = useInvoices();
  const run = usePaymentRun();
  const now = useNow();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("due");

  const decisions = useMemo(() => {
    const m = new Map<string, { kind: "payable" | "approval" | "blocked"; label: string }>();
    for (const l of run?.lines ?? []) {
      if (!l.decision.ok) m.set(l.invoiceId as string, { kind: "blocked", label: refusalLabel(l.decision.reason) });
      else if (l.policy && !l.policy.ok) m.set(l.invoiceId as string, { kind: "approval", label: APPROVAL_REASONS.has(l.policy.reason) ? "needs approval" : refusalLabel(l.policy.reason) });
      else m.set(l.invoiceId as string, { kind: "payable", label: "payable" });
    }
    return m;
  }, [run]);

  if (rows === undefined)
    return (
      <div className="space-y-4">
        <PageHeader title="Invoices" description="Loading every invoice with its remit account, case and payment…" />
        <Loading label="Loading invoices…" />
      </div>
    );

  const isOverdue = (r: Row) => r.status !== "paid" && now > 0 && r.dueAt < now;
  const q = query.trim().toLowerCase();
  const visible = rows
    .filter((r) => (status === "all" ? true : status === "overdue" ? isOverdue(r) : r.status === status))
    .filter((r) => !q || r.number.toLowerCase().includes(q) || r.vendorName.toLowerCase().includes(q) || (r.remit?.last4 ?? "").includes(q))
    .sort((a, b) => (sort === "amount" ? b.amountCents - a.amountCents : sort === "vendor" ? a.vendorName.localeCompare(b.vendorName) || a.dueAt - b.dueAt : a.dueAt - b.dueAt));
  const sum = (pred: (r: Row) => boolean) => rows.filter(pred).reduce((s, r) => s + r.amountCents, 0);
  const count = (pred: (r: Row) => boolean) => rows.filter(pred).length;

  function exportCsv() {
    const cols = ["Invoice", "Vendor", "Amount (USD)", "Issued", "Due", "Status", "Remit routing", "Remit last4", "Remit version", "Remit status", "Payment decision", "Case state", "Paid at", "Rail"];
    const body = visible.map((r) => {
      const d = r.status === "paid" ? { label: "paid" } : decisions.get(r._id as string);
      return [r.number, r.vendorName, (r.amountCents / 100).toFixed(2), new Date(r.issuedAt).toISOString().slice(0, 10), new Date(r.dueAt).toISOString().slice(0, 10), r.status, r.remit?.routing ?? "", r.remit?.last4 ?? "", r.remit?.version ?? "", r.remit?.status ?? "missing", d?.label ?? "", r.caseState ?? "", r.payment ? new Date(r.payment.sentAt).toISOString() : "", r.payment?.rail ?? ""];
    });
    downloadText(`landed-invoices-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(cols, body));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="Every invoice on file with the account it remits to, what the payment boundary would do with it today, and the case holding it if one is open. Paying happens on the payment run."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}>
            <Download size={14} aria-hidden /> Export CSV
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Open" value={usd(sum((r) => r.status === "open"))} hint={`${count((r) => r.status === "open")} invoice(s) remitting to a verified or unverified account`} />
        <StatCard label="Held" value={usd(sum((r) => r.status === "held"))} hint={`${count((r) => r.status === "held")} held while a bank change is verified`} tone={count((r) => r.status === "held") ? "amber" : undefined} />
        <StatCard label="Overdue" value={usd(sum(isOverdue))} hint={`${count(isOverdue)} past due and unpaid`} tone={count(isOverdue) ? "red" : undefined} />
        <StatCard label="Paid" value={usd(sum((r) => r.status === "paid"))} hint={`${count((r) => r.status === "paid")} sent through the boundary`} tone="green" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No invoices" description="Re-seed the fixtures from Settings or record an invoice from a vendor message." action={{ label: "Open Settings", href: "/settings" }} />
      ) : (
        <section className="ops-queue" aria-label="Invoices">
          <div className="ops-toolbar">
            <div className="ops-search-field">
              <Search size={15} />
              <input aria-label="Search invoices" placeholder="Search invoice number, vendor or last four" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ops-toolbar-selects">
              <select aria-label="Filter invoices" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="all">All ({rows.length})</option>
                <option value="open">Open ({count((r) => r.status === "open")})</option>
                <option value="held">Held ({count((r) => r.status === "held")})</option>
                <option value="overdue">Overdue ({count(isOverdue)})</option>
                <option value="paid">Paid ({count((r) => r.status === "paid")})</option>
              </select>
              <select aria-label="Sort invoices" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="due">Due date</option>
                <option value="amount">Amount, largest first</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No invoice matches this filter.</p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remits to</TableHead>
                  <TableHead>Boundary today</TableHead>
                  <TableHead>Case</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const d = decisions.get(r._id as string);
                  const overdue = isOverdue(r);
                  return (
                    <TableRow key={r._id} className={cn(overdue && "bg-red-50/40")}>
                      <TableCell className="font-mono text-xs">{r.number}</TableCell>
                      <TableCell className="text-sm">
                        <Link href={`/vendors/${r.vendorId}`} className="hover:underline">
                          {r.vendorName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">{usd(r.amountCents)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{absDate(r.issuedAt)}</TableCell>
                      <TableCell className={cn("font-mono text-xs tabular-nums", overdue ? "font-medium text-red-800" : "text-muted-foreground")}>
                        {absDate(r.dueAt)}
                        {overdue && <span className="ml-1 rounded border border-red-200 bg-red-50 px-1 text-[10px] uppercase">overdue</span>}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {r.remit ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs tabular-nums">
                              {r.remit.routing} · …{r.remit.last4} · v{r.remit.version}
                            </span>
                            <AccountStatusBadge status={r.remit.status} />
                          </span>
                        ) : (
                          <span className="text-xs text-red-800">missing</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.status === "paid" ? (
                          <span className="text-xs text-slate-700">
                            paid {r.payment ? `${absDate(r.payment.sentAt)} · ${r.payment.rail.toUpperCase()} · ${r.payment.landingState}` : ""}
                          </span>
                        ) : run === undefined ? (
                          <span className="text-xs text-muted-foreground">evaluating…</span>
                        ) : d ? (
                          <span
                            className={cn(
                              "rounded border px-1.5 text-xs",
                              d.kind === "payable" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : d.kind === "approval" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900",
                            )}
                          >
                            {d.label}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.caseId ? (
                          <Link href={`/cases/${r.caseId}`} className="inline-flex items-center gap-1.5 text-xs underline">
                            <CaseStatusBadge state={r.caseState ?? ""} showToken={false} />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        “Boundary today” is the same decision the payment run shows: the guard first (verified, current-version account of the invoice&apos;s vendor), then company policy. It is a preview, not a payment.{" "}
        <Link href="/payment-run" className="underline">
          Open the payment run →
        </Link>
      </p>
    </div>
  );
}
