"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Link2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, StatCard } from "@/components/landed/primitives";
import { useAuditChain, useOverview, usePolicy, useScreeningSummary, useApiKeys, useWebhookEndpoints } from "@/lib/hooks";
import { absTime } from "@/lib/format";

type Control = {
  id: string;
  control: string;
  how: string;
  evidence: string; // test file(s)
  soc2: string;
  nist: string;
  coso: string;
  status: "enforced" | "configurable" | "planned";
};

const CONTROLS: Control[] = [
  { id: "I1", control: "No payment to an unverified destination", how: "payments.send is the only writer of payments; canPay refuses unless the destination exists, belongs to the vendor, is verified and current. Refusals are returned, not thrown, so the audit row survives.", evidence: "tests/canPay.test.ts, tests/invariants.test.ts, tests/security.test.ts", soc2: "CC6.1, CC6.3, PI1.3, CC5.2", nist: "PR.DS-01, PR.PS-01", coso: "Automated preventive application control", status: "enforced" },
  { id: "I2", control: "Every new destination starts unverified and opens a case", how: "Intake, manual edit and seed all go through createUnverifiedWithHash → openCase. Open invoices follow the request and are held.", evidence: "tests/invariants.test.ts, tests/checkpoint1.test.ts", soc2: "CC8.1, PI1.2", nist: "PR.DS-02, GV.SC-06", coso: "Vendor master change control", status: "enforced" },
  { id: "I3", control: "Verification is bound (case, vendor, account hash + version, probe, amount, contact of record, unused, unexpired)", how: "canRelease checks in fixed order inside one transaction; success flips the account, consumes the confirmation and transitions the case atomically.", evidence: "tests/canRelease.test.ts, tests/hardening.test.ts (property tests)", soc2: "CC6.2, PI1.3", nist: "PR.AA-01, PR.AA-03", coso: "Independent verification; dual control", status: "enforced" },
  { id: "I4", control: "Untrusted channels cannot confirm", how: "Email statements are stored rejected and never evaluated against the probe; unaccepted statements never reach the gate (no amount oracle).", evidence: "tests/invariants.test.ts, tests/hardening2.test.ts", soc2: "CC6.1, CC6.7", nist: "PR.AA-05", coso: "Authentication of counterparties", status: "enforced" },
  { id: "I5", control: "The AI cannot release money", how: "No LLM-calling action imports or schedules markVerified, payments.send, exceptionalRelease or account status. Structural, checked by a static test.", evidence: "tests/security.test.ts", soc2: "CC6.3, CC8.1", nist: "PR.AA-05, GV.RR-02", coso: "Segregation of duties (machine)", status: "enforced" },
  { id: "I6", control: "Money movement is idempotent", how: "Deterministic idempotency keys on probes and payments; rails honour them; the API's Idempotency-Key adds a 24h request-level layer.", evidence: "tests/invariants.test.ts, tests/api.test.ts", soc2: "PI1.3, CC7.2", nist: "PR.DS-01", coso: "Duplicate-payment prevention", status: "enforced" },
  { id: "I7", control: "The probe amount is secret", how: "Never in public queries, events (redaction), channel configs, LLM prompts, transcripts or webhooks. The only comparison happens inside one mutation.", evidence: "tests/security.test.ts, tests/vapiRequest.test.ts, tests/hardening2.test.ts", soc2: "C1.1, CC6.1", nist: "PR.DS-01", coso: "Confidentiality of control parameters", status: "enforced" },
  { id: "I8", control: "Deterministic timers", how: "Every SLA, settlement and landing deadline is a row on the application clock fired by one tick; per-timer error isolation.", evidence: "tests/invariants.test.ts, eval/ scenarios", soc2: "CC7.2, PI1.4", nist: "DE.CM-01", coso: "Timely follow-up", status: "enforced" },
  { id: "C1", control: "Maker-checker (dual approval) above a threshold", how: "approvals.request by a maker; approvals.decide by a distinct approver/admin; payments.send consumes exactly one approval per payment.", evidence: "tests/policy.test.ts", soc2: "CC5.1, CC6.3, CC3.2", nist: "PR.AA-05, GV.RR-02", coso: "Segregation of duties; dual authorization (Principle 10)", status: "configurable" },
  { id: "C2", control: "Risk-based review", how: "Deterministic 16-signal score; policy can require sign-off above a score. Risk never releases.", evidence: "tests/risk.test.ts, tests/policy.test.ts", soc2: "CC7.2, CC7.3, CC3.2", nist: "DE.AE-02, DE.CM-09", coso: "Detective monitoring control", status: "configurable" },
  { id: "C3", control: "Cooling-off after verification; ACH-first for a new account; daily vendor limit", how: "Evaluated in payments.send after the guard; first failing control is the refusal reason.", evidence: "tests/policy.test.ts", soc2: "CC6.1, PI1.3", nist: "PR.DS-01", coso: "Payment limits; recoverability", status: "configurable" },
  { id: "C4", control: "Sanctions screening at onboarding and before payment", how: "Jaro-Winkler + token-sort against the watchlist; approver dispositions; policy can block on an open hit. Production loads OFAC SDN + consolidated lists.", evidence: "tests/screening.test.ts", soc2: "CC9.2, CC2.3", nist: "GV.SC-04, ID.RA-03", coso: "Regulatory compliance (OFAC)", status: "configurable" },
  { id: "C5", control: "Known-bad account numbers never get another probe", how: "A rejected/disputed prior version of the identity or the same account under another vendor sends the case straight to a human.", evidence: "tests/hardening2.test.ts", soc2: "CC7.2, CC6.1", nist: "DE.AE-06", coso: "Fraud pattern control", status: "enforced" },
  { id: "C6", control: "Landing confirmation for every payment", how: "Landing check and deadline timers on each payment; vendor of record confirms, or an operator attests with a note; unconfirmed payments surface for recovery.", evidence: "tests/hardening2.test.ts, eval/ legit scenarios", soc2: "PI1.4, CC7.2", nist: "DE.CM-01", coso: "Bank-to-ledger reconciliation", status: "enforced" },
  { id: "A1", control: "Append-only audit log with hash chain and redaction", how: "events has no update/delete path; the auditor view recomputes a SHA-256 chain; probe amounts and account numbers never enter events.", evidence: "tests/security.test.ts, convex/audit.ts", soc2: "CC7.2, CC4.1, PI1.5", nist: "DE.CM-03, PR.PS-04", coso: "Audit trail; evidence retention", status: "enforced" },
  { id: "A2", control: "Named operators with server-enforced roles", how: "Clerk / approver / admin; policy and key management are admin-only; the requester can never approve. Operators sign in with email + password (Convex Auth, httpOnly cookie sessions); sign-up is by invitation: an administrator records the operator's email first.", evidence: "tests/policy.test.ts, tests/api.test.ts", soc2: "CC6.1, CC6.2, CC6.3", nist: "PR.AA-01..06", coso: "Logical access ITGC", status: "configurable" },
  { id: "A3", control: "Secrets and encryption", how: "Account numbers HMAC-hashed and AES-256-GCM encrypted at rest; keys in deployment env; API keys stored as SHA-256; webhook secrets shown once.", evidence: "convex/crypto.ts, tests/api.test.ts", soc2: "CC6.1, CC6.7, C1.1", nist: "PR.DS-01, PR.DS-02", coso: "Data protection", status: "enforced" },
  { id: "A4", control: "Authenticated integrations", how: "Scoped API keys, per-key rate limit, idempotent writes, signed webhooks with replay tolerance; the Vapi webhook requires a shared secret and binds only to calls Landed placed.", evidence: "tests/api.test.ts, tests/hardening2.test.ts", soc2: "CC6.6, CC6.7", nist: "PR.AA-05, PR.DS-02", coso: "Interface controls", status: "enforced" },
  { id: "R1", control: "Incident response and recovery package", how: "Mark fraud → account disputed, recovery package (bank recall + FBI IC3) from deterministic fields with template fallback.", evidence: "tests/checkpoint1.test.ts, convex/packageTemplates.ts", soc2: "CC7.3, CC7.4, CC7.5, CC9.1", nist: "RS.MA, RS.CO, RC.RP", coso: "Incident response; loss recovery", status: "enforced" },
  { id: "P1", control: "End-user single sign-on (SSO/SCIM) and MFA for approvers", how: "Not in this build: sessions are email + password (Convex Auth) mapped to the operator table. Planned: SSO/SCIM identities mapped to operators; MFA required for approver and admin roles.", evidence: "—", soc2: "CC6.1, CC6.2", nist: "PR.AA-01", coso: "Logical access ITGC", status: "planned" },
];

const STATUS_TONE: Record<Control["status"], string> = { enforced: "border-emerald-200 bg-emerald-50 text-emerald-900", configurable: "border-amber-200 bg-amber-50 text-amber-900", planned: "border-slate-200 bg-slate-50 text-slate-700" };

export default function CompliancePage() {
  const chain = useAuditChain();
  const o = useOverview();
  const policy = usePolicy();
  const screening = useScreeningSummary();
  const keys = useApiKeys();
  const endpoints = useWebhookEndpoints();
  const [head, setHead] = useState<{ head: string; count: number; computedAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | Control["status"]>("all");

  const rows = CONTROLS.filter((c) => filter === "all" || c.status === filter);
  const enforced = CONTROLS.filter((c) => c.status === "enforced").length;
  const configurable = CONTROLS.filter((c) => c.status === "configurable").length;
  const activeControls = policy ? [policy.dualApprovalAboveCents !== null, policy.riskReviewAbove !== null, policy.coolingOffHours > 0, policy.maxPerVendorPerDayCents !== null, policy.blockWireForFirstPayment, policy.blockOnScreeningHit].filter(Boolean).length : 0;

  function exportMatrix() {
    const cols = ["Id", "Control", "How it is enforced", "Evidence", "SOC 2 TSC", "NIST CSF 2.0", "COSO / SOX", "Status"];
    const lines = [cols, ...CONTROLS.map((c) => [c.id, c.control, c.how, c.evidence, c.soc2, c.nist, c.coso, c.status])].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `landed-controls-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Controls matrix"
        description="Every control, how the code enforces it, the test that proves it, and where it maps in SOC 2, NIST CSF 2.0 and COSO. Evidence for an auditor, not a claim of certification."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={exportMatrix}>
              <Download size={14} /> Export CSV
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setHead(await chain({}));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Link2 size={14} /> {busy ? "Hashing…" : "Verify audit chain"}
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Controls enforced in code" value={String(enforced)} hint={`${configurable} more are policy-configurable`} tone="green" />
        <StatCard label="Policy controls active" value={`${activeControls} / 6`} hint={<Link href="/controls" className="underline underline-offset-2">Controls page</Link>} tone={activeControls ? "green" : "amber"} />
        <StatCard label="Vendors screened" value={screening ? `${screening.screenedVendors} / ${screening.screenedVendors + screening.unscreened}` : "…"} hint={screening ? `${screening.potentialMatches} open hit${screening.potentialMatches === 1 ? "" : "s"}` : ""} tone={screening && screening.unscreened ? "amber" : "green"} />
        <StatCard label="Audit events" value={head ? String(head.count) : o ? "—" : "…"} hint={head ? `chain head ${head.head.slice(0, 12)}… at ${absTime(head.computedAt)}` : "click Verify audit chain"} />
      </div>
      <Section
        title="Matrix"
        description={`${CONTROLS.length} controls. Status: enforced = structural, cannot be switched off; configurable = on/off per policy; planned = not in this build.`}
        actions={
          <select aria-label="Filter controls" className="h-7 rounded-md border bg-white px-2 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All</option>
            <option value="enforced">Enforced</option>
            <option value="configurable">Configurable</option>
            <option value="planned">Planned</option>
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Id</th>
                <th className="py-1 pr-2">Control</th>
                <th className="py-1 pr-2">How</th>
                <th className="py-1 pr-2">Evidence</th>
                <th className="py-1 pr-2">SOC 2</th>
                <th className="py-1 pr-2">NIST CSF 2.0</th>
                <th className="py-1 pr-2">COSO / SOX</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y align-top">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-2 font-mono">{c.id}</td>
                  <td className="py-2 pr-2 font-medium text-slate-900">{c.control}</td>
                  <td className="py-2 pr-2 text-slate-700">{c.how}</td>
                  <td className="py-2 pr-2 font-mono text-[10px] text-slate-700">{c.evidence}</td>
                  <td className="py-2 pr-2">{c.soc2}</td>
                  <td className="py-2 pr-2">{c.nist}</td>
                  <td className="py-2 pr-2">{c.coso}</td>
                  <td className="py-2">
                    <span className={`rounded border px-1.5 text-[10px] ${STATUS_TONE[c.status]}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Integration surface" description="What is reachable from outside and how it is authenticated.">
          <ul className="space-y-1 text-sm">
            <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-700" /> REST API: {keys ? `${keys.filter((k) => !k.revokedAt).length} active key${keys.filter((k) => !k.revokedAt).length === 1 ? "" : "s"}` : "…"}, scoped, hashed, rate-limited, idempotent.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-700" /> Webhooks: {endpoints ? `${endpoints.filter((e) => e.active).length} active endpoint${endpoints.filter((e) => e.active).length === 1 ? "" : "s"}` : "…"}, HMAC-SHA256 signed, 8 attempts, SSRF-guarded URLs.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-700" /> Voice webhook: shared secret required; binds only to calls Landed placed.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-700" /> Vendor portal: bcrypt credentials, httpOnly session, per-user lockout, rate limits.</li>
            <li className="flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-700" /> Eval endpoints: shared key, fail closed when unset, numeric validation.</li>
          </ul>
        </Section>
        <Section title="Reference" description="Standards this maps to.">
          <ul className="space-y-1 text-xs text-slate-700">
            <li>AICPA Trust Services Criteria (2017, 2022 points of focus): CC5–CC9, PI1, C1.</li>
            <li>NIST Cybersecurity Framework 2.0 (Feb 2024): GV, ID, PR, DE, RS, RC categories.</li>
            <li>COSO 2013 Internal Control, Principle 10 (control activities incl. segregation of duties, dual authorization); SOX 404 ITGCs.</li>
            <li>Nacha Operating Rules: Micro-Entries (ACCTVERIFY, Phase 2 fraud monitoring, 2023); WEB debit account validation (2021).</li>
            <li>OFAC: SDN and consolidated lists; screening at onboarding and before payment; ODFI obligations for ACH.</li>
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Mapping prepared for a controls walkthrough; a SOC 2 report requires an independent auditor.</p>
        </Section>
      </div>
    </div>
  );
}
