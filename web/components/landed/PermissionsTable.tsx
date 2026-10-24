"use client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** What the agent can and cannot call, as enforced in the database. Shared by /about and /pitch. */
export const PERMISSIONS: [string, string, string, string][] = [
  ["Read a vendor email and PDF, extract a requested account", "yes", "yes (manual edit)", "every new account starts unverified and opens a case (I2)"],
  ["Open a case and queue the probe deposit", "yes (via bankAccounts.createUnverified)", "yes", "same"],
  ["Re-point open invoices to the requested account (held)", "yes", "yes", "invoices follow the request; nothing is payable until verified"],
  ["Record a stated amount", "only trusted channels (voice of record, portal login); email is stored rejected", "\"Simulate vendor answer\" in sim mode, labeled", "I4"],
  ["Verify an account (markVerified)", "no", "no (only the bound confirmation does, atomically)", "I3"],
  ["Pay", "no", "yes, and only to a verified current-version account of that vendor", "I1, fail closed"],
  ["Exceptional release", "no", "two distinct named approvers + written reason, from NEEDS_HUMAN only", "logged with both names"],
  ["Edit contacts or account status", "no", "supersede contact; add human-attested record contact", "I5"],
  ["Draft the recovery package prose", "yes, from deterministic fields; every number verified", "reviews, signs, calls", "fallback to templates"],
  ["Know the probe amount", "no (not in prompts, tools, events, or public queries)", "no (operator reads the bank statement; test-only endpoint is key-gated)", "I7"],
];

export function PermissionsTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Capability</TableHead>
            <TableHead>Agent (LLM / intake / package actions)</TableHead>
            <TableHead>Human (dashboard)</TableHead>
            {!compact && <TableHead>Database rule</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERMISSIONS.map(([cap, agent, human, rule]) => (
            <TableRow key={cap}>
              <TableCell className="text-sm">{cap}</TableCell>
              <TableCell className={agent.startsWith("no") ? "text-sm font-semibold text-red-800" : "text-sm"}>{agent}</TableCell>
              <TableCell className="text-sm">{human}</TableCell>
              {!compact && <TableCell className="text-xs text-muted-foreground">{rule}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
