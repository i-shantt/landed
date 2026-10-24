"use client";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StateBadge } from "@/components/state-badge";
import { useNow } from "@/components/clock-display";
import { usd, absTime, countdown } from "@/lib/format";
import { TRIGGER_LABELS } from "@/lib/labels";

export default function CasesPage() {
  const cases = useQuery(api.cases.list, {});
  const now = useNow();
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Cases</h1>
        <p className="text-sm text-muted-foreground">Every bank-account change is a case. Nothing is paid to a destination until its case reaches VERIFIED.</p>
      </div>
      {cases === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases yet. Send a bank-change email from the Mailbox or edit a vendor&apos;s bank account.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead className="text-right">Amount at stake</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Opened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c) => (
              <TableRow key={c._id} className="cursor-pointer" onClick={() => router.push(`/cases/${c._id}`)}>
                <TableCell className="font-medium">{c.vendorName}</TableCell>
                <TableCell>
                  <StateBadge state={c.state} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{TRIGGER_LABELS[c.triggerType] ?? c.triggerType}</TableCell>
                <TableCell className="text-right font-mono text-sm">{usd(c.amountAtStakeCents)}</TableCell>
                <TableCell className="font-mono text-sm">{c.state === "AWAITING_CONFIRMATION" ? countdown(c.slaDeadlineAt, now) : "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{absTime(c.openedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
