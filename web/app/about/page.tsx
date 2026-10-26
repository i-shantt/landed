"use client";
import Link from "next/link";
import { PageHeader, Section } from "@/components/landed/primitives";
import { PermissionsTable } from "@/components/landed/PermissionsTable";
import { useEvalRuns } from "@/lib/hooks";
import { summarizeEvalRuns } from "@/lib/eval-metrics";
import { Term } from "@/components/landed/Term";


const REAL = [
  "the Convex engine and the eight invariants (serializable mutations make the release gate and idempotency atomic)",
  "versioned bank accounts with HMAC hashing and AES-256-GCM encryption of account numbers",
  "the append-only audit log with redaction",
  "the rule-based extractor and the Claude extractor (PDFs passed as documents) when a key is set",
  "the vendor portal login (bcrypt, cookie session)",
  "the eval harness: every scripted scenario run twice (extractor on, extractor off)",
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
  const runs = useEvalRuns();
  const ev = summarizeEvalRuns(runs);
  return (
    <div className="space-y-4 print:space-y-3">
      <PageHeader title="About Landed" description="No payment can be sent to a bank account that has not been verified for that specific vendor, even when the AI misses the email.">
        <p className="text-sm italic text-slate-800">Fills the payment-verification clerk seat and the first hour of the fraud-response coordinator seat; a human still releases money.</p>
      </PageHeader>

      <div id="permissions" className="scroll-mt-20">
      <Section title="What the agent can and cannot do" description="Permissions as enforced in the database, not as prompt instructions.">
        <PermissionsTable />
        <p className="mt-3 text-xs text-muted-foreground">
          When it asks for a human: wrong or missing vendor statement, bank and contact changed in the same request, <Term k="sla">SLA</Term> expiry with no statement, portal attempts exhausted, validation-provider mismatch, and any <Term k="landing">landing</Term> deadline that passes without the vendor confirming.
        </p>
      </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Where Claude could go wrong, and what catches it">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>It misses an implicit change buried in a PDF, so the deterministic guard still blocks any unverified destination.</li>
            <li>It drafts package prose with a wrong number, so every number is checked against the deterministic fields and templates are the fallback.</li>
            <li>It over-flags a benign email, so a human can reject the change and restore the prior account.</li>
            <li>It cannot verify anything, because it has no release path: the release gate and the payment guard are database mutations with no LLM input.</li>
          </ul>
        </Section>
        <Section title="How contacts of record are established" description="The one thing the attacker does not control.">
          <p className="text-sm">
            A <Term k="contact_of_record">contact of record</Term> is a phone number or portal login captured at onboarding and confirmed by a call placed to a number from the signed contract, never to a number from a request email. Changing it is a separate human-attested step with a written reason; a request that changes the bank account and the contact together goes straight to a human.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Built on Convex: schema and indexes, transactional mutations as the security boundary, actions for LLM/rails/channels, scheduler as dispatch, crons for tick, HTTP actions, file storage, real-time subscriptions, convex-test.
          </p>
        </Section>
      </div>

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
          A vitest suite of unit and invariant tests (convex-test; the count is generated into the README by <code className="font-mono text-xs">scripts/sync-measured.mjs</code>), a scripted click-through of every page, and an eval of{" "}
          {ev ? (
            <>
              <span className="font-mono tabular-nums">{ev.scenarios}</span> scripted scenarios run with the extractor on and off: the last posted run is{" "}
              <span className="font-mono tabular-nums">{ev.passed} / {ev.total}</span> passed
            </>
          ) : (
            <>scripted scenarios run with the extractor on and off (no run has been posted to this deployment yet; see <Link href="/eval" className="underline">Evaluations</Link>)</>
          )}
          . See <Link href="/eval" className="underline">Evaluations</Link> for the per-scenario table and the metrics. {ev?.disclaimer ?? "These are results on scripted cases; they do not establish effectiveness against real-world fraud."}
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
