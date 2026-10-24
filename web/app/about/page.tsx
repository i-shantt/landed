"use client";
import Link from "next/link";
import { PageHeader, Section } from "@/components/landed/primitives";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useEvalRuns } from "@/lib/hooks";

const PERMISSIONS: [string, string, string, string][] = [
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

const REAL = [
  "the Convex engine and the eight invariants (serializable mutations make the release gate and idempotency atomic)",
  "versioned bank accounts with HMAC hashing and AES-256-GCM encryption of account numbers",
  "the append-only audit log with redaction",
  "the rule-based extractor and the Claude extractor (PDFs passed as documents) when a key is set",
  "the vendor portal login (bcrypt, cookie session)",
  "the eval harness: 20 scenarios run twice (extractor on, extractor off)",
  "Nessie transfers on the mock bank (deposit plus withdrawal, integer cents) when the rail is switched to Nessie",
  "the recovery package's deterministic fields; Claude prose is checked number by number",
];
const SIMULATED = [
  "the bank (SimRail, an in-database ledger) unless Nessie is selected",
  "time (a demo clock drives ACH windows, availability, SLAs and landing deadlines)",
  "vendor answers (the eval harness or a human types what the vendor sees; the Vapi/Cartesia voice channel is written but was not dialed)",
  "email authentication results (seeded)",
  "the vendor's bank statement",
];
const INVARIANTS: [string, string][] = [
  ["I1 Payment boundary", "payments.send is the only function that inserts a payment. It refuses unless the destination exists, belongs to the invoice's vendor, is verified, and is the current version of that account identity. Fail closed."],
  ["I2 New destinations start unverified", "and open a case, whatever path created them (intake, manual edit, seed)."],
  ["I3 Verification is bound", "to case, vendor, account hash, account version, probe, probe availability, exact amount, a contact that is of record now, and an unused, unexpired confirmation. Success flips the account, marks the confirmation used, transitions the case, and logs, atomically."],
  ["I4 Untrusted channels cannot confirm", "Email statements are stored as rejected and never considered."],
  ["I5 The agent cannot release", "No LLM-calling action can reach markVerified, payments.send, exceptionalRelease, or account status."],
  ["I6 Money movement is idempotent", "Probes and payments carry deterministic idempotency keys."],
  ["I7 The probe amount is secret", "No public query, event, or channel configuration carries it."],
  ["I8 Timers are deterministic", "Every timeout is a row on the application clock, fired by one tick."],
];

export default function AboutPage() {
  const runs = useEvalRuns() as { scenarioId: string; metrics?: { passed?: number; total?: number } }[] | undefined;
  const m = runs?.find((r) => r.scenarioId === "__metrics__")?.metrics;
  return (
    <div className="space-y-4 print:space-y-3">
      <PageHeader title="About Landed" description="No payment can be sent to a bank account that has not been verified for that specific vendor, even when the AI misses the email.">
        <p className="text-sm italic text-slate-800">Fills the payment-verification clerk seat and the first hour of the fraud-response coordinator seat; a human still releases money.</p>
      </PageHeader>

      <Section title="What the agent can and cannot do" description="Permissions as enforced in the database, not as prompt instructions.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Agent (LLM / intake / package actions)</TableHead>
                <TableHead>Human (dashboard)</TableHead>
                <TableHead>Database rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map(([cap, agent, human, rule]) => (
                <TableRow key={cap}>
                  <TableCell className="text-sm">{cap}</TableCell>
                  <TableCell className={agent.startsWith("no") ? "text-sm font-semibold text-red-800" : "text-sm"}>{agent}</TableCell>
                  <TableCell className="text-sm">{human}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{rule}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          When it asks for a human: wrong or missing vendor statement, bank and contact changed in the same request, SLA expiry with no statement, portal attempts exhausted, validation-provider mismatch, and any landing deadline that passes without the vendor confirming.
        </p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="What is real">
          <ul className="list-disc space-y-1 pl-5 text-sm">{REAL.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
        <Section title="What is simulated" description="Every simulation is labeled on screen.">
          <ul className="list-disc space-y-1 pl-5 text-sm">{SIMULATED.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
      </div>

      <Section title="How we know">
        <p className="text-sm">
          89 unit and invariant tests (vitest + convex-test), a scripted click-through of every page, and an eval of 20 scripted scenarios run twice (extractor on and off)
          {m && typeof m.passed === "number" ? <>: the last posted run is <span className="font-mono tabular-nums">{m.passed} / {m.total}</span> passed</> : null}.
          {" "}See <Link href="/eval" className="underline">Eval</Link> for the per-scenario table and the metrics. These are results on scripted cases; they do not establish effectiveness against real-world fraud.
        </p>
      </Section>

      <Section title="Invariants (enforced in code, each with a test)">
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {INVARIANTS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-slate-900">{k}</dt>
              <dd className="text-slate-700">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
