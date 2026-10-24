"use client";
import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { AccountStatusBadge, CaseStatusBadge } from "@/components/landed/badges";
import { Term } from "@/components/landed/Term";
import { usePaymentRun, useSendPayment } from "@/lib/hooks";
import { usd, absDate } from "@/lib/format";
import { refusalLabel } from "@/lib/labels";
import { errorMessage } from "@/components/landed/ReasonDialog";

type LineResult = { kind: "paid" | "duplicate" | "refused" | "error"; text: string };

export default function PaymentRunPage() {
  const run = usePaymentRun();
  const send = useSendPayment();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, LineResult>>({});

  if (run === undefined) return <Loading />;
  const payable = run.lines.filter((l) => l.decision.ok);

  async function runPayable() {
    setConfirm(false);
    setBusy(true);
    // Snapshot the payable set now; each line is re-evaluated by the server on send.
    const ids = payable.map((l) => l.invoiceId);
    for (const invoiceId of ids) {
      try {
        const r = await send({ invoiceId, initiatedBy: "payment-run", rail: "ach" });
        setResults((prev) => ({ ...prev, [invoiceId]: r.ok ? { kind: r.duplicate ? "duplicate" : "paid", text: r.duplicate ? `already paid earlier (${r.paymentId})` : `paid · ${r.paymentId}` } : { kind: "refused", text: `${refusalLabel(r.reason)} (${r.reason})` } }));
      } catch (e) {
        setResults((prev) => ({ ...prev, [invoiceId]: { kind: "error", text: errorMessage(e) } }));
      }
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment run"
        description={<span className="block max-w-3xl">The week&apos;s batch. Each line is evaluated by the same guard the payment function uses; blocked lines stay blocked until their case is verified. A <Term k="probe">probe</Term> that has not been read back by the <Term k="contact_of_record">contact of record</Term> keeps the invoice held.</span>}
        actions={
          <Button disabled={busy || payable.length === 0} onClick={() => setConfirm(true)}>
            {busy ? "Running…" : `Run payable (${payable.length})`}
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Payable" value={usd(run.totals.payableCents)} hint={`${run.totals.payable} invoice${run.totals.payable === 1 ? "" : "s"} to verified, current-version accounts`} tone={run.totals.payable > 0 ? "green" : undefined} />
        <StatCard label="Blocked" value={usd(run.totals.blockedCents)} hint={`${run.totals.blocked} invoice${run.totals.blocked === 1 ? "" : "s"} refused by the guard`} tone={run.totals.blocked > 0 ? "red" : undefined} />
      </div>
      {run.lines.length === 0 ? (
        <EmptyState title="No open invoices" description="Every invoice is paid. Send a bank-change email from the Mailbox or re-seed to get a batch." action={{ label: "Open the Mailbox", href: "/mailbox" }} />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
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
              {run.lines.map((l) => {
                const res = results[l.invoiceId as string];
                return (
                  <TableRow key={l.invoiceId}>
                    <TableCell className="font-mono text-xs">{l.number}</TableCell>
                    <TableCell className="text-sm">{l.vendorName}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{usd(l.amountCents)}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">{absDate(l.dueAt)}</TableCell>
                    <TableCell>
                      {l.destination ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs tabular-nums">{l.destination.routing} · …{l.destination.last4} · v{l.destination.version}</span>
                          <AccountStatusBadge status={l.destination.status} />
                        </span>
                      ) : (
                        <span className="text-xs text-red-800">missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.decision.ok ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-xs text-emerald-900">payable</span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-red-200 bg-red-50 px-1.5 text-xs text-red-900">{refusalLabel(l.decision.reason)}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{l.decision.reason}</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.caseId ? (
                        <Link href={`/cases/${l.caseId}`} className="inline-flex items-center gap-1.5 text-xs underline">
                          <CaseStatusBadge state={l.caseState ?? ""} showToken={false} />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {res ? (
                        <span className={res.kind === "paid" ? "text-emerald-800" : res.kind === "duplicate" ? "text-slate-700" : "text-red-800"}>{res.text}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run {payable.length} payable invoice{payable.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              {usd(run.totals.payableCents)} to verified accounts, sent one by one by <code className="font-mono">payments.send</code>. Blocked lines are never sent; the server re-checks every line as it goes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={runPayable}>Run payable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
