"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import { AuthBadge } from "@/components/landed/badges";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { useVendors, useMessages, useMailboxActions } from "@/lib/hooks";
import { absTime } from "@/lib/format";
import { INTAKE_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const TEMPLATES: Record<string, { label: string; subject: string; body: string }> = {
  change: { label: "Bank change request", subject: "Updated banking details", body: "Hi, we have changed banks effective this month. Please update our remittance details for all open and future invoices:\nBank: First Harbor Bank\nRouting (ABA): 011000015\nAccount number: 900012345678\nThanks,\nDana, Accounts Receivable" },
  invoice: { label: "Invoice with new remit details", subject: "Invoice CC-2026-0419", body: "Please find attached invoice CC-2026-0419 for $18,400.00. Note our updated remit-to information in the footer: ABA 011000015, account 900012345678." },
  receipt: { label: "We received your deposit", subject: "Re: Updated banking details", body: "We can confirm receipt of your $0.37 test deposit today. Please release the full payment to the new account." },
  benign: { label: "Benign status update", subject: "October schedule", body: "Just confirming the October service schedule is unchanged. No action needed on billing." },
};
const OUTCOME_LABELS: Record<string, string> = {
  case_opened: "Case opened", existing_case: "Existing case reused", no_change: "No bank change found", receipt_claim_ignored: "Receipt claim ignored", unknown_vendor_held: "Unknown sender; nothing bound", historical: "Historical",
};
function homoglyph(domain: string) { const s = domain.replace("l", "1"); return s === domain ? domain.replace("o", "0") : s; }

export default function MailboxPage() {
  const vendors = useVendors();
  const messages = useMessages();
  const { insert, generateUploadUrl } = useMailboxActions();
  const [vendorId, setVendorId] = useState("");
  const [fromKind, setFromKind] = useState<"real" | "homoglyph" | "subdomain" | "freemail" | "custom">("real");
  const [customFrom, setCustomFrom] = useState("");
  const [template, setTemplate] = useState("change");
  const [subject, setSubject] = useState(TEMPLATES.change.subject);
  const [body, setBody] = useState(TEMPLATES.change.body);
  const [dmarc, setDmarc] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const vendor = vendors?.find((v) => v._id === vendorId) ?? vendors?.find((v) => v.slug === "cleanco") ?? vendors?.[0];
  const slug = vendor?.slug ?? vendor?.domain.split(".")[0] ?? "vendor";
  const from = useMemo(() => {
    if (!vendor) return "";
    switch (fromKind) {
      case "real": return `ap@${vendor.domain}`;
      case "homoglyph": return `ap@${homoglyph(vendor.domain)}`;
      case "subdomain": return `ap@${vendor.domain}.billing-portal.example`;
      case "freemail": return `${slug}.billing@gmail.example`;
      case "custom": return customFrom;
    }
  }, [vendor, fromKind, customFrom, slug]);

  const threads = useMemo(() => {
    const map = new Map<string, NonNullable<typeof messages>>();
    for (const m of messages ?? []) { const arr = map.get(m.threadId) ?? []; arr.push(m); map.set(m.threadId, arr); }
    const list = Array.from(map.entries()).map(([id, msgs]) => ({ id, msgs: msgs.slice().sort((a, b) => a.sentAt - b.sentAt) }));
    list.sort((a, b) => Math.max(...b.msgs.map((m) => m.sentAt)) - Math.max(...a.msgs.map((m) => m.sentAt)));
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((t) => t.msgs.some((m) => m.subject.toLowerCase().includes(needle) || m.from.toLowerCase().includes(needle) || m.body.toLowerCase().includes(needle) || (m.vendorName ?? "").toLowerCase().includes(needle))) : list;
  }, [messages, q]);
  const current = threads.find((t) => t.id === selectedThread) ?? null;

  async function send() {
    setBusy(true); setNote(null);
    try {
      const attachmentStorageIds: Id<"_storage">[] = [];
      if (file) {
        const url = await generateUploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "content-type": file.type || "application/pdf" }, body: file });
        attachmentStorageIds.push(((await res.json()) as { storageId: Id<"_storage"> }).storageId);
      }
      await insert({ from, to: "ap@meridianoutdoor.example", subject, body, dmarc, attachmentStorageIds, vendorId: fromKind === "real" && vendor ? vendor._id : undefined });
      setNote("Sent. Intake is running; the thread appears on the left.");
      setFile(null);
      setSelectedThread(null);
    } catch (e) { setNote(`Error: ${errorMessage(e)}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Mailbox" description="Inbox simulator. Authentication results are seeded, not real. Intake runs with the extractor mode from Settings." />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Section title="Threads" actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search threads" className="h-7 w-36 text-xs" />} className="lg:max-h-[75vh] lg:overflow-hidden">
          {messages === undefined ? <Loading /> : threads.length === 0 ? <p className="text-sm text-muted-foreground">No messages.</p> : (
            <ul className="-mx-4 -my-3 max-h-[70vh] divide-y overflow-y-auto">
              <li>
                <button type="button" onClick={() => setSelectedThread(null)} className={cn("w-full px-4 py-2 text-left text-sm hover:bg-muted", selectedThread === null && "bg-accent")} aria-pressed={selectedThread === null}>
                  <span className="font-medium">Compose</span>
                  <span className="block text-xs text-muted-foreground">as the vendor, or as an attacker</span>
                </button>
              </li>
              {threads.map((t) => {
                const last = t.msgs[t.msgs.length - 1];
                const r = (last.intakeResult ?? {}) as Record<string, unknown>;
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => setSelectedThread(t.id)} className={cn("w-full px-4 py-2 text-left text-sm hover:bg-muted", selectedThread === t.id && "bg-accent")} aria-pressed={selectedThread === t.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-900">{last.subject}</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{absTime(last.sentAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate font-mono">{last.from}</span>
                        {r.changed === true && <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-900">bank change</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {current ? (
          <Section title={current.msgs[current.msgs.length - 1].subject} description={<span className="font-mono text-[11px]">thread {current.id}</span>}>
            <ul className="divide-y">
              {current.msgs.map((m) => {
                const r = (m.intakeResult ?? {}) as Record<string, unknown>;
                return (
                  <li key={m._id} className="space-y-1.5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs">{m.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-xs">{m.to}</span>
                      <AuthBadge dmarc={m.authResult.dmarc} />
                      {m.vendorName ? <span className="rounded border px-1.5 text-[11px]">{m.vendorName}</span> : <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[11px] text-amber-900">unknown sender</span>}
                      <span className="rounded border px-1.5 text-[11px]">{INTAKE_STATUS_LABELS[m.intakeStatus] ?? m.intakeStatus}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{absTime(m.sentAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-800">{m.body}</p>
                    {m.intakeStatus === "done" && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="rounded border bg-muted px-1.5">{OUTCOME_LABELS[String(r.outcome ?? (r.historical ? "historical" : ""))] ?? "No outcome"}</span>
                        <span className="rounded border px-1.5">extractor: <span className="font-mono">{String(r.mode ?? "—")}</span></span>
                        {typeof r.claimedVendor === "string" && <span className="rounded border border-red-200 bg-red-50 px-1.5 text-red-800">claims to be {r.claimedVendor}</span>}
                        {typeof r.caseId === "string" && <Link className="underline" href={`/cases/${r.caseId}`}>Open the case →</Link>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : (
          <Section title="Compose as the vendor (or an attacker)" description="Sends to AP. The sender preset controls whether the domain matches the vendor of record.">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="mb-vendor">Vendor</Label>
                  <NativeSelect id="mb-vendor" value={vendor?._id ?? ""} onChange={(e) => setVendorId(e.target.value)}>
                    {(vendors ?? []).map((v) => <option key={v._id} value={v._id}>{v.name} ({v.domain})</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mb-from">From</Label>
                  <NativeSelect id="mb-from" value={fromKind} onChange={(e) => setFromKind(e.target.value as typeof fromKind)}>
                    <option value="real">Vendor&apos;s real address</option>
                    <option value="homoglyph">Lookalike: homoglyph domain</option>
                    <option value="subdomain">Lookalike: subdomain</option>
                    <option value="freemail">Lookalike: display-name spoof, free-mail</option>
                    <option value="custom">Custom</option>
                  </NativeSelect>
                  {fromKind === "custom" ? <Input value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} placeholder="someone@example" className="font-mono" aria-label="Custom sender" /> : <p className="font-mono text-xs text-muted-foreground">{from}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mb-to">To</Label>
                  <Input id="mb-to" value="ap@meridianoutdoor.example" readOnly className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mb-template">Template</Label>
                  <NativeSelect id="mb-template" value={template} onChange={(e) => { setTemplate(e.target.value); const t = TEMPLATES[e.target.value]; if (t) { setSubject(t.subject); setBody(t.body); } }}>
                    {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                  </NativeSelect>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mb-subject">Subject</Label>
                <Input id="mb-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mb-body">Body</Label>
                <Textarea id="mb-body" value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="font-mono text-xs" />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="space-y-1">
                  <Label htmlFor="mb-file">PDF attachment (optional)</Label>
                  <Input id="mb-file" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={dmarc} onChange={(e) => setDmarc(e.target.checked)} />
                  SPF/DKIM/DMARC pass
                </label>
                <Button disabled={busy || !from || !subject} onClick={send}>Send to AP</Button>
              </div>
              {note && <p className="text-sm" role="status">{note}</p>}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
