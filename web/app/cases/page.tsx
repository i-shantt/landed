"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaseStatusBadge } from "@/components/landed/badges";
import { PageHeader, StatCard, EmptyState, Loading } from "@/components/landed/primitives";
import { useCases, useNow, useSettings } from "@/lib/hooks";
import { Term } from "@/components/landed/Term";
import Link from "next/link";
import { usd, absTime, countdown } from "@/lib/format";
import { triggerLabel, stateLabel } from "@/lib/labels";
import { CASE_STATES } from "@/lib/enums";
import { cn } from "@/lib/utils";

const TERMINAL = new Set(["CLOSED"]);

export default function CasesPage() {
  const cases = useCases();
  const now = useNow();
  const router = useRouter();
  const settings = useSettings();
  const [filter, setFilter] = useState<string | null>(null);
  const demo = useMemo(() => parseDemoCases(settings?.demoCases), [settings?.demoCases]);
  const demoIds = useMemo(() => new Set(demo.map((d) => d.caseId)), [demo]);
  const demoRows = useMemo(() => demo.map((d) => ({ ...d, c: (cases ?? []).find((c) => c._id === d.caseId) })).filter((d) => d.c), [demo, cases]);

  const stats = useMemo(() => {
    const open = (cases ?? []).filter((c) => !TERMINAL.has(c.state));
    return {
      open: open.length,
      blocked: open.filter((c) => !["VERIFIED", "PAID", "LANDED"].includes(c.state)).reduce((s, c) => s + c.amountAtStakeCents, 0),
      human: open.filter((c) => c.state === "NEEDS_HUMAN").length,
    };
  }, [cases]);
  const present = useMemo(() => new Set((cases ?? []).filter((c) => !demoIds.has(c._id)).map((c) => c.state)), [cases, demoIds]);
  const liveCases = (cases ?? []).filter((c) => !demoIds.has(c._id));
  const rows = liveCases.filter((c) => !filter || c.state === filter);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Verification cases"
        description={
          <span className="block max-w-3xl">
            <Term k="accounts_payable">Accounts payable</Term> pays vendors to the bank account stored in the <Term k="vendor_master">vendor record</Term>; <Term k="bec">business email compromise</Term> works by getting that one field changed.
            Landed turns every change into a verification case: nothing is paid to the new account until the vendor&apos;s <Term k="contact_of_record">contact of record</Term> reads back a randomized <Term k="probe">test deposit</Term>.
          </span>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open cases" value={stats.open} />
        <StatCard label="Amount blocked" value={usd(stats.blocked)} hint="open invoices pointed at unverified destinations" tone={stats.blocked > 0 ? "amber" : undefined} />
        <StatCard label="Needing a human" value={stats.human} tone={stats.human > 0 ? "amber" : undefined} />
      </div>
      {demoRows.length > 0 && (
        <section aria-labelledby="demo-cases" className="rounded-md border bg-card">
          <div className="flex items-baseline justify-between border-b px-4 py-2.5">
            <h2 id="demo-cases" className="text-sm font-medium text-slate-900">Demo cases</h2>
            <span className="text-xs text-muted-foreground">pre-run at seed time so each outcome is one click away</span>
          </div>
          <ul className="divide-y">
            {demoRows.map((d) => (
              <li key={d.caseId}>
                <Link href={`/cases/${d.caseId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="min-w-56 font-medium text-slate-900">{d.label}</span>
                  <span className="text-muted-foreground">{d.c!.vendorName}</span>
                  <CaseStatusBadge state={d.c!.state} showToken={false} />
                  <span className="ml-auto font-mono text-xs tabular-nums text-slate-800" title="Amount at stake: open invoices pointed at this case's destination">{usd(d.c!.amountAtStakeCents)}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{absTime(d.c!.openedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {cases === undefined ? (
        <Loading />
      ) : liveCases.length === 0 ? (
        <EmptyState title={demoRows.length ? "No live cases yet" : "No cases yet"} description="Send a bank-change email from the Mailbox or edit a vendor's bank account to open one." action={{ label: "Send a bank-change email", href: "/mailbox" }} />
      ) : (
        <>
          {demoRows.length > 0 && <h2 className="pt-1 text-sm font-medium text-slate-900">Live queue</h2>}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
            <FilterChip active={filter === null} onClick={() => setFilter(null)} label="All" count={liveCases.length} />
            {CASE_STATES.filter((s) => present.has(s)).map((s) => (
              <FilterChip key={s} active={filter === s} onClick={() => setFilter(filter === s ? null : s)} label={stateLabel(s)} count={liveCases.filter((c) => c.state === s).length} />
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

function parseDemoCases(raw: string | undefined): { caseId: string; label: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is { caseId: string; label: string } => !!x && typeof x === "object" && typeof (x as { caseId?: unknown }).caseId === "string" && typeof (x as { label?: unknown }).label === "string");
  } catch {
    return [];
  }
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs hover:bg-muted", active && "border-primary bg-accent text-accent-foreground")}>
      {label}
      <span className="font-mono tabular-nums text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
