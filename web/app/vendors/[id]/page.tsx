"use client";
import { use, useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect } from "@/components/native-select";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import { CaseStatusBadge, AccountStatusBadge, InvoiceStatusBadge } from "@/components/landed/badges";
import { ContactList } from "@/components/landed/ContactList";
import { ReasonDialog, errorMessage } from "@/components/landed/ReasonDialog";
import { useVendor, useVendorActions, useEnvPresence, useDevTools } from "@/lib/hooks";
import { usd, absDate, absTime } from "@/lib/format";
import { triggerLabel, CONTACT_KIND_LABELS } from "@/lib/labels";

export default function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const vendorId = id as Id<"vendors">;
  const v = useVendor(vendorId);
  const { supersede, addRecord, manualEdit, discover } = useVendorActions();
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const envPresence = useEnvPresence();
  const { simulateDiscovery } = useDevTools();
  const [editing, setEditing] = useState<{ accountId: Id<"bankAccounts">; last4: string } | null>(null);
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [editResult, setEditResult] = useState<{ ok: boolean; text: string; caseId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [supersedeId, setSupersedeId] = useState<Id<"contacts"> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newKind, setNewKind] = useState<"phone" | "portal" | "email">("phone");
  const [newValue, setNewValue] = useState("");
  const [attested, setAttested] = useState("");

  if (v === undefined) return <Loading />;
  if (v === null) return <p className="text-sm text-red-700">Vendor not found.</p>;
  const accountById = new Map(v.accounts.map((a) => [a._id, a]));

  return (
    <div className="space-y-4">
      <PageHeader title={v.name} description={<span className="font-mono text-xs">{v.domain} · onboarded {absDate(v.onboardedAt)}{v.hasPortalLogin ? " · portal login" : ""}</span>} />

      {editResult && (
        <Alert variant={editResult.ok ? "default" : "destructive"} role="status">
          <AlertTitle>{editResult.ok ? "Bank account recorded as unverified" : "Edit failed"}</AlertTitle>
          <AlertDescription>
            {editResult.text}{" "}
            {editResult.caseId && <Link className="underline" href={`/cases/${editResult.caseId}`}>Open the case →</Link>}
          </AlertDescription>
        </Alert>
      )}

      <Section
        title="Contacts"
        description={<>Only a contact of record, reached on its established channel, can confirm a probe.{discoverMsg && <span className="block text-amber-800">{discoverMsg}</span>}</>}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={discovering} onClick={async () => { setDiscovering(true); try { const r = await discover({ vendorId }); setDiscoverMsg(r.ok ? `Discovered ${r.phones?.length ?? 0} phone number(s) from the website (cross-check only).` : `Discovery skipped: ${r.reason}`); } catch (e) { setDiscoverMsg(errorMessage(e)); } finally { setDiscovering(false); } }}>
              Discover from website (Apify)
            </Button>
            {envPresence && !envPresence.APIFY_TOKEN && (
              <>
                <Button size="sm" variant="outline" onClick={async () => { try { const r = await simulateDiscovery({ vendorId, matchesRecord: true }); setDiscoverMsg(r.mismatch ? "Simulated discovery: the discovered phone differs from the phone of record." : "Simulated discovery: the discovered phone matches the phone of record."); } catch (e) { setDiscoverMsg(errorMessage(e)); } }} title="Dev control: stands in for the Apify crawl when no token is set">
                  Simulate discovery (match)
                </Button>
                <Button size="sm" variant="outline" onClick={async () => { try { const r = await simulateDiscovery({ vendorId, matchesRecord: false }); setDiscoverMsg(r.mismatch ? "Simulated discovery: the discovered phone differs from the phone of record (event logged)." : "Simulated discovery recorded."); } catch (e) { setDiscoverMsg(errorMessage(e)); } }} title="Dev control: stands in for the Apify crawl when no token is set">
                  Simulate discovery (mismatch)
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>Add contact of record</Button>
          </>
        }
      >
        <CrossCheck contacts={v.contacts} />
        <ContactList contacts={v.contacts} onSupersede={(id) => setSupersedeId(id as Id<"contacts">)} />
      </Section>

      <Section title="Bank accounts" description="Editing never changes a row. It creates a new unverified version and opens a case; the edited row is superseded.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="hidden md:table-cell">First paid</TableHead>
              <TableHead className="hidden md:table-cell">Created via</TableHead>
              <TableHead className="w-36" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.accounts.map((a) => (
              <TableRow key={a._id}>
                <TableCell><AccountStatusBadge status={a.status} /></TableCell>
                <TableCell className="font-mono text-xs">v{a.version}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{a.routing}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">…{a.accountLast4}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{absDate(a.firstPaidAt)}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{a.createdVia.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-right">
                  {(a.status === "verified" || a.status === "unverified" || a.status === "probing") && (
                    <Button size="xs" variant="outline" onClick={() => { setEditing({ accountId: a._id, last4: a.accountLast4 }); setRouting(a.routing); setAccount(""); setEditResult(null); }}>
                      Edit account
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Invoices" description="Open invoices follow a bank-change request and are blocked until the destination is verified.">
          {v.invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remit to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.invoices.map((i) => {
                  const acct = accountById.get(i.remitAccountId);
                  return (
                    <TableRow key={i._id}>
                      <TableCell className="font-mono text-xs">{i.number}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{usd(i.amountCents)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{absDate(i.dueAt)}</TableCell>
                      <TableCell><InvoiceStatusBadge status={i.status} /></TableCell>
                      <TableCell className="font-mono text-xs">…{acct?.accountLast4 ?? "????"} {acct && <AccountStatusBadge status={acct.status} />}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
        <Section title="Cases">
          {v.cases.length === 0 ? <p className="text-sm text-muted-foreground">No cases.</p> : (
            <ul className="divide-y">
              {v.cases.map((c) => (
                <li key={c._id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <CaseStatusBadge state={c.state} showToken={false} />
                  <Link className="hover:underline" href={`/cases/${c._id}`}>{triggerLabel(c.triggerType)}</Link>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{absTime(c.openedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit bank account (…{editing?.last4})</DialogTitle>
            <DialogDescription>This creates a new unverified account version and opens a verification case. The row you are editing becomes superseded. Nothing is paid to the new account until the vendor of record confirms the probe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-routing">Routing (ABA, 9 digits)</Label>
              <Input id="edit-routing" value={routing} onChange={(e) => setRouting(e.target.value)} className="font-mono" inputMode="numeric" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-account">Account number</Label>
              <Input id="edit-account" value={account} onChange={(e) => setAccount(e.target.value)} className="font-mono" placeholder="new account number" inputMode="numeric" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy || !routing || !account} onClick={async () => {
              if (!editing) return;
              setBusy(true);
              try {
                const r = await manualEdit({ vendorId, routing, accountNumber: account, replacesAccountId: editing.accountId });
                setEditResult({ ok: true, text: r.reused ? "This account already has an open case; reusing it." : "New version created as unverified; the previous row is superseded. A case was opened and a probe deposit queued.", caseId: r.caseId ?? undefined });
                setEditing(null);
              } catch (e) { setEditResult({ ok: false, text: errorMessage(e) }); }
              finally { setBusy(false); }
            }}>
              Save new account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReasonDialog open={!!supersedeId} onOpenChange={(o) => !o && setSupersedeId(null)} title="Supersede this contact" description="A superseded contact can no longer confirm anything, including confirmations already recorded against open cases." confirmLabel="Supersede" destructive onConfirm={async (reason) => { if (supersedeId) await supersede({ contactId: supersedeId, reason }); }} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add contact of record</DialogTitle>
            <DialogDescription>Prototype: a human attests this contact. In production this requires a separate verification process (onboarding form plus verified call).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-kind">Kind</Label>
              <NativeSelect id="new-kind" value={newKind} onChange={(e) => setNewKind(e.target.value as typeof newKind)}>
                {(["phone", "portal", "email"] as const).map((k) => <option key={k} value={k}>{CONTACT_KIND_LABELS[k]}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-value">Value</Label>
              <Input id="new-value" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="+15550100099" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-attested">Attested by</Label>
              <Input id="new-attested" value={attested} onChange={(e) => setAttested(e.target.value)} placeholder="your name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button disabled={busy || !newValue || !attested} onClick={async () => { setBusy(true); try { await addRecord({ vendorId, kind: newKind, value: newValue, attestedBy: attested }); setAddOpen(false); setNewValue(""); } finally { setBusy(false); } }}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


/** Discovered-vs-record cross-check summary: shown only when both kinds of phone exist. */
function CrossCheck({ contacts }: { contacts: { kind: string; value: string; trustLevel: string; supersededAt?: number }[] }) {
  const record = contacts.filter((c) => c.kind === "phone" && c.trustLevel === "record" && !c.supersededAt).map((c) => c.value);
  const discovered = contacts.filter((c) => c.kind === "phone" && c.trustLevel === "discovered").map((c) => c.value);
  if (record.length === 0 || discovered.length === 0) return null;
  const mismatches = discovered.filter((d) => !record.includes(d));
  return (
    <p className={`mb-2 rounded border px-2 py-1 text-xs ${mismatches.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role="status">
      {mismatches.length
        ? `Cross-check: ${mismatches.length} discovered phone number(s) differ from the phone of record. Discovered contacts are cross-check only; they never confirm anything.`
        : "Cross-check: the discovered phone matches the phone of record."}
    </p>
  );
}
