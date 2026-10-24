"use client";
import { useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { PageHeader, Section } from "@/components/landed/primitives";
import { TrustBadge } from "@/components/landed/badges";
import { Term } from "@/components/landed/Term";
import { useOnboarding } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid_domain: "Enter a domain like vendor.example.",
  domain_exists: "A vendor with this domain already exists.",
  vendor_not_found: "The vendor was not found; start again.",
  reason_too_short: "Say how the contact was verified (at least 15 characters).",
  routing_must_be_9_digits: "The routing number must be 9 digits.",
  account_4_to_17_digits: "The account number must be 4 to 17 digits.",
  password_too_short: "Use at least 8 characters.",
  username_taken: "That portal username is taken.",
};

function plain(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  const code = typeof data === "string" ? data : data && typeof data === "object" && "code" in (data as object) ? String((data as { code: string }).code) : null;
  if (code && ERRORS[code]) return ERRORS[code];
  const msg = (e as Error)?.message ?? String(e);
  const m = msg.match(/Uncaught (?:ConvexError|Error): ([^\n]+)/);
  const raw = m ? m[1] : msg;
  return ERRORS[raw.trim()] ?? raw;
}

type Step = 1 | 2 | 3 | 4 | 5;

export default function NewVendorPage() {
  const ob = useOnboarding();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // step 1
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [onboardedBy, setOnboardedBy] = useState("");
  const [vendorId, setVendorId] = useState<Id<"vendors"> | null>(null);
  // step 2
  const [kind, setKind] = useState<"phone" | "portal">("phone");
  const [value, setValue] = useState("");
  const [attestedBy, setAttestedBy] = useState("");
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState<{ kind: string; value: string } | null>(null);
  // step 3
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [created, setCreated] = useState<{ accountId: string; caseId: string | null } | null>(null);
  // step 4
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [portalDone, setPortalDone] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(plain(e));
    } finally {
      setBusy(false);
    }
  }

  const steps = ["Vendor", "Contact of record", "First bank account", "Portal login"];

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Onboard a vendor" description={<>Four steps. The second one is the control: the <Term k="contact_of_record">contact of record</Term> is established here by a person who states how it was verified, and it is the only channel that can ever confirm a <Term k="probe">probe</Term>.</>} />

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Progress">
        {steps.map((s, i) => {
          const n = (i + 1) as Step;
          const done = step > n;
          const active = step === n;
          return (
            <li key={s} className={cn("flex items-center gap-1.5 rounded border px-2 py-1", active && "border-[#1E3A8A] text-[#1E3A8A]", done && "bg-green-50 border-green-200 text-green-800", !active && !done && "text-muted-foreground")}>
              <span className="font-mono tabular-nums">{n}</span> {s}{done ? " ✓" : ""}
            </li>
          );
        })}
      </ol>

      {err && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      )}

      {/* Step 1 */}
      <Section title="1. Vendor" description="The company you will pay. Historical threads and invoices can be attached later.">
        {vendorId ? (
          <p className="text-sm">Recorded: <span className="font-medium text-slate-900">{name}</span> · <span className="font-mono text-xs">{domain}</span> · onboarded by {onboardedBy}</p>
        ) : (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { const id = await ob.createVendor({ name, domain, onboardedBy }); setVendorId(id); setStep(2); }); }}>
            <div className="space-y-1"><Label htmlFor="v-name">Name</Label><Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pine Ridge Signage" required /></div>
            <div className="space-y-1"><Label htmlFor="v-domain">Email domain</Label><Input id="v-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="pineridgesignage.example" className="font-mono" required /></div>
            <div className="space-y-1"><Label htmlFor="v-by">Onboarded by</Label><Input id="v-by" value={onboardedBy} onChange={(e) => setOnboardedBy(e.target.value)} placeholder="your name" required /></div>
            <div className="sm:col-span-3"><Button type="submit" disabled={busy || !name || !domain || !onboardedBy}>Create vendor</Button></div>
          </form>
        )}
      </Section>

      {/* Step 2 */}
      <Section title="2. Contact of record" description={<>Only this contact, reached on this channel, can state what the <Term k="probe">probe</Term> deposited. It is never taken from a request email, so a human records it and says how it was verified.</>} className={cn(step < 2 && "opacity-50")}>
        {contact ? (
          <p className="text-sm flex flex-wrap items-center gap-2">Recorded: <span className="font-mono text-xs">{contact.kind} {contact.value}</span> <TrustBadge level="record" /> <span className="text-muted-foreground">attested by {attestedBy}: “{reason}”</span></p>
        ) : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!vendorId) return; void run(async () => { await ob.attestRecordContact({ vendorId, kind, value, attestedBy, reason }); setContact({ kind, value }); setStep(3); }); }}>
            <div className="space-y-1"><Label htmlFor="c-kind">Kind</Label><NativeSelect id="c-kind" value={kind} onChange={(e) => setKind(e.target.value as "phone" | "portal")} disabled={step < 2}><option value="phone">Phone (E.164)</option><option value="portal">Portal username</option></NativeSelect></div>
            <div className="space-y-1"><Label htmlFor="c-value">Value</Label><Input id="c-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "phone" ? "+15550100777" : slug || "username"} className="font-mono" disabled={step < 2} required /></div>
            <div className="space-y-1"><Label htmlFor="c-by">Attested by</Label><Input id="c-by" value={attestedBy} onChange={(e) => setAttestedBy(e.target.value)} placeholder="your name" disabled={step < 2} required /></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="c-reason">How was it verified? (min 15 characters)</Label><Textarea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="verified by phone call to the number on the signed W-9" disabled={step < 2} rows={2} /><p className="text-[11px] text-muted-foreground font-mono tabular-nums">{reason.trim().length}/15</p></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={busy || step < 2 || !value || !attestedBy || reason.trim().length < 15}>Attest contact of record</Button></div>
          </form>
        )}
      </Section>

      {/* Step 3 */}
      <Section title="3. First bank account" description={<>Starts <span className="font-mono text-xs">unverified</span> and opens a case; the <Term k="probe">probe</Term> goes out on the next <Term k="ach">ACH</Term> window. Nothing can be paid to it until the contact of record reads the amount back.</>} className={cn(step < 3 && "opacity-50")}>
        {created ? (
          <p className="text-sm">Recorded as unverified. {created.caseId ? <Link className="underline" href={`/cases/${created.caseId}`}>Open the case →</Link> : "No case was opened (the account was already known)."}</p>
        ) : (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (!vendorId) return; void run(async () => { const r = await ob.addFirstAccount({ vendorId, routing, accountNumber: account }); setCreated({ accountId: r.accountId, caseId: r.caseId }); setUsername(slug); setStep(4); }); }}>
            <div className="space-y-1"><Label htmlFor="a-routing">Routing (ABA, 9 digits)</Label><Input id="a-routing" value={routing} onChange={(e) => setRouting(e.target.value)} placeholder="021000021" className="font-mono" inputMode="numeric" disabled={step < 3} required /></div>
            <div className="space-y-1"><Label htmlFor="a-account">Account number</Label><Input id="a-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="123456789012" className="font-mono" inputMode="numeric" disabled={step < 3} required /></div>
            <div className="flex items-end"><Button type="submit" disabled={busy || step < 3 || !routing || !account}>Add account</Button></div>
          </form>
        )}
      </Section>

      {/* Step 4 */}
      <Section title="4. Portal login (optional)" description="A second contact of record: the vendor can confirm probes by logging in instead of answering a call." className={cn(step < 4 && "opacity-50")} actions={step === 4 && !portalDone ? <Button size="sm" variant="outline" onClick={() => setStep(5)}>Skip</Button> : undefined}>
        {portalDone ? (
          <p className="text-sm">Issued. The vendor can now sign in at <Link className="underline font-mono text-xs" href="/portal/login">/portal/login</Link> as <span className="font-mono text-xs">{username}</span>.</p>
        ) : (
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (!vendorId) return; void run(async () => { await ob.issuePortalCredential({ vendorId, username, password, issuedBy }); setPortalDone(true); setStep(5); }); }}>
            <div className="space-y-1"><Label htmlFor="p-user">Username</Label><Input id="p-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={slug || "username"} className="font-mono" disabled={step < 4} /></div>
            <div className="space-y-1"><Label htmlFor="p-pass">Password (min 8)</Label><Input id="p-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={step < 4} autoComplete="new-password" /></div>
            <div className="space-y-1"><Label htmlFor="p-by">Issued by</Label><Input id="p-by" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="your name" disabled={step < 4} /></div>
            <div className="sm:col-span-3"><Button type="submit" disabled={busy || step < 4 || !username || password.length < 8 || !issuedBy}>Issue portal login</Button></div>
          </form>
        )}
      </Section>

      {step === 5 && vendorId && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-green-50 border-green-200 px-4 py-3 text-sm text-green-900">
          Onboarding complete. The first account is held until the contact of record confirms the probe.
          <Button size="sm" nativeButton={false} render={<Link href={`/vendors/${vendorId}`} />}>Open vendor page →</Button>
        </div>
      )}
    </div>
  );
}
