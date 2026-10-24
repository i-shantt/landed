"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/native-select";
import { errorMessage } from "@/components/reason-dialog";
import { absTime } from "@/lib/format";

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  change: {
    subject: "Updated banking details",
    body: "Hi, we have changed banks effective this month. Please update our remittance details for all open and future invoices:\nBank: First Harbor Bank\nRouting (ABA): 011000015\nAccount number: 900012345678\nThanks,\nDana, Accounts Receivable",
  },
  invoice: {
    subject: "Invoice CC-2026-0419",
    body: "Please find attached invoice CC-2026-0419 for $18,400.00. Note our updated remit-to information in the footer: ABA 011000015, account 900012345678.",
  },
  receipt: {
    subject: "Re: Updated banking details",
    body: "We can confirm receipt of your $0.37 test deposit today. Please release the full payment to the new account.",
  },
  benign: {
    subject: "October schedule",
    body: "Just confirming the October service schedule is unchanged. No action needed on billing.",
  },
};

function homoglyph(domain: string) {
  const swapped = domain.replace("l", "1");
  return swapped === domain ? domain.replace("o", "0") : swapped;
}

export default function MailboxPage() {
  const vendors = useQuery(api.vendors.list, {});
  const messages = useQuery(api.messages.list, {});
  const insert = useMutation(api.messages.insert);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);

  const [vendorId, setVendorId] = useState<string>("");
  const [fromKind, setFromKind] = useState<"real" | "homoglyph" | "subdomain" | "freemail" | "custom">("real");
  const [customFrom, setCustomFrom] = useState("");
  const [template, setTemplate] = useState<string>("change");
  const [subject, setSubject] = useState(TEMPLATES.change.subject);
  const [body, setBody] = useState(TEMPLATES.change.body);
  const [dmarc, setDmarc] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const vendor = vendors?.find((v) => v._id === vendorId) ?? vendors?.[0];
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
    for (const m of messages ?? []) {
      const arr = map.get(m.threadId) ?? [];
      arr.push(m);
      map.set(m.threadId, arr);
    }
    return Array.from(map.entries()).sort((a, b) => Math.max(...b[1].map((m) => m.sentAt)) - Math.max(...a[1].map((m) => m.sentAt)));
  }, [messages]);

  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const attachmentStorageIds: Id<"_storage">[] = [];
      if (file) {
        const url = await generateUploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "content-type": file.type || "application/pdf" }, body: file });
        const json = (await res.json()) as { storageId: Id<"_storage"> };
        attachmentStorageIds.push(json.storageId);
      }
      const id = await insert({
        from,
        to: "ap@meridianoutdoor.example",
        subject,
        body,
        dmarc,
        attachmentStorageIds,
        // Only bind to a vendor explicitly when the sender is the vendor's real address; lookalikes must resolve (or not) by domain.
        vendorId: fromKind === "real" && vendor ? vendor._id : undefined,
      });
      setNote(`Sent. Message ${id}; intake is running.`);
      setFile(null);
    } catch (e) {
      setNote(`Error: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mailbox</h1>
        <p className="text-sm text-muted-foreground">Inbox simulator. Authentication results are seeded, not real.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Compose as the vendor (or an attacker)</CardTitle>
          <CardDescription>Sends to AP; intake runs with the extractor mode from Settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Vendor</Label>
              <NativeSelect value={vendor?._id ?? ""} onChange={(e) => setVendorId(e.target.value)}>
                {(vendors ?? []).map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.name} ({v.domain})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>From</Label>
              <NativeSelect value={fromKind} onChange={(e) => setFromKind(e.target.value as typeof fromKind)}>
                <option value="real">Vendor&apos;s real address</option>
                <option value="homoglyph">Lookalike: homoglyph domain</option>
                <option value="subdomain">Lookalike: subdomain</option>
                <option value="freemail">Lookalike: display-name spoof, free-mail</option>
                <option value="custom">Custom</option>
              </NativeSelect>
              {fromKind === "custom" ? <Input value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} placeholder="someone@example" className="font-mono" /> : <p className="text-xs font-mono text-muted-foreground">{from}</p>}
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <Input value="ap@meridianoutdoor.example" readOnly className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Template</Label>
              <NativeSelect
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  const t = TEMPLATES[e.target.value];
                  if (t) {
                    setSubject(t.subject);
                    setBody(t.body);
                  }
                }}
              >
                <option value="change">Bank change request</option>
                <option value="invoice">Invoice with new remit details</option>
                <option value="receipt">We received your deposit</option>
                <option value="benign">Benign status update</option>
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} className="font-mono text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="space-y-1">
              <Label>PDF attachment (optional)</Label>
              <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={dmarc} onChange={(e) => setDmarc(e.target.checked)} />
              SPF/DKIM/DMARC pass
            </label>
            <Button disabled={busy || !from || !subject} onClick={send}>
              Send to AP
            </Button>
          </div>
          {note && <p className="text-sm">{note}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Threads</CardTitle>
        </CardHeader>
        <CardContent>
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            <div className="space-y-4">
              {threads.map(([threadId, msgs]) => (
                <div key={threadId} className="rounded-md border">
                  <div className="px-3 py-1.5 text-xs text-muted-foreground border-b bg-muted/40 font-mono">thread {threadId}</div>
                  <ul className="divide-y">
                    {msgs
                      .slice()
                      .sort((a, b) => a.sentAt - b.sentAt)
                      .map((m) => {
                        const r = (m.intakeResult ?? {}) as Record<string, unknown>;
                        return (
                          <li key={m._id} className="px-3 py-2 text-sm space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs">{m.from}</span>
                              <span className="font-medium">{m.subject}</span>
                              <Badge variant="outline" className={m.authResult.dmarc ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"}>
                                DMARC {m.authResult.dmarc ? "pass" : "fail"}
                              </Badge>
                              {m.vendorName ? <Badge variant="outline">{m.vendorName}</Badge> : <Badge variant="outline" className="bg-amber-100 text-amber-900">unknown sender</Badge>}
                              <Badge variant="outline">intake: {m.intakeStatus}</Badge>
                              <span className="text-xs text-muted-foreground">{absTime(m.sentAt)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{m.body}</p>
                            {m.intakeStatus === "done" && (
                              <div className="text-xs flex flex-wrap gap-2 items-center">
                                <span>
                                  outcome: <span className="font-mono">{String(r.outcome ?? (r.historical ? "historical" : "—"))}</span>
                                </span>
                                <span>
                                  extractor: <span className="font-mono">{String(r.mode ?? "—")}</span>
                                </span>
                                {typeof r.changed === "boolean" && <span>changed: {String(r.changed)}</span>}
                                {typeof r.caseId === "string" && (
                                  <Link className="underline" href={`/cases/${r.caseId}`}>
                                    case →
                                  </Link>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
