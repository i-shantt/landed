"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaseStatusBadge } from "@/components/landed/badges";
import { PageHeader, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { useCases, useNow } from "@/lib/hooks";
import { usd, absTime, countdown } from "@/lib/format";
import { triggerLabel, stateLabel } from "@/lib/labels";
import { CASE_STATES } from "@/lib/enums";
import { cn } from "@/lib/utils";

const TERMINAL = new Set(["CLOSED"]);

export default function CasesPage() {
  const cases = useCases();
  const now = useNow();
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(null);

  const stats = useMemo(() => {
    const open = (cases ?? []).filter((c) => !TERMINAL.has(c.state));
    return {
      open: open.length,
      blocked: open.filter((c) => !["VERIFIED", "PAID", "LANDED"].includes(c.state)).reduce((s, c) => s + c.amountAtStakeCents, 0),
      human: open.filter((c) => c.state === "NEEDS_HUMAN").length,
    };
  }, [cases]);
  const present = useMemo(() => new Set((cases ?? []).map((c) => c.state)), [cases]);
  const rows = (cases ?? []).filter((c) => !filter || c.state === filter);

  return (
    <div className="space-y-4">
      <PageHeader title="Verification cases" description="Every bank-account change is a case. Nothing is paid to a destination until its case reaches Verified." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open cases" value={stats.open} />
        <StatCard label="Amount blocked" value={usd(stats.blocked)} hint="open invoices pointed at unverified destinations" tone={stats.blocked > 0 ? "amber" : undefined} />
        <StatCard label="Needing a human" value={stats.human} tone={stats.human > 0 ? "amber" : undefined} />
      </div>
      {cases === undefined ? (
        <Loading />
      ) : cases.length === 0 ? (
        <EmptyState title="No cases yet" description="Send a bank-change email from the Mailbox or edit a vendor's bank account to open one." action={{ label: "Send a bank-change email", href: "/mailbox" }} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
            <FilterChip active={filter === null} onClick={() => setFilter(null)} label="All" count={cases.length} />
            {CASE_STATES.filter((s) => present.has(s)).map((s) => (
              <FilterChip key={s} active={filter === s} onClick={() => setFilter(filter === s ? null : s)} label={stateLabel(s)} count={cases.filter((c) => c.state === s).length} />
            ))}
          </div>
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden md:table-cell">Trigger</TableHead>
                  <TableHead className="text-right">At stake</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="hidden sm:table-cell">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const sla = c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt ? c.slaDeadlineAt - now : null;
                  return (
                    <TableRow key={c._id} className="cursor-pointer hover:bg-muted/60" onClick={() => router.push(`/cases/${c._id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/cases/${c._id}`); }}>
                      <TableCell className="font-medium text-slate-900">{c.vendorName}</TableCell>
                      <TableCell><CaseStatusBadge state={c.state} showToken={false} /></TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">{triggerLabel(c.triggerType)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{usd(c.amountAtStakeCents)}</TableCell>
                      <TableCell className={cn("font-mono tabular-nums text-xs", sla !== null && sla < 4 * 3_600_000 && "text-amber-800 font-medium")}>{sla !== null ? countdown(c.slaDeadlineAt, now) : "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">{absTime(c.openedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs hover:bg-muted", active && "border-primary bg-accent text-accent-foreground")}>
      {label}
      <span className="font-mono tabular-nums text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
