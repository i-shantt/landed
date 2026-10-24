"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect } from "@/components/native-select";
import { StateBadge, AccountStatusBadge } from "@/components/state-badge";
import { TrustBadge } from "@/components/trust-badge";
import { ReasonDialog, errorMessage } from "@/components/reason-dialog";
import { usd, absDate, absTime } from "@/lib/format";
import { TRIGGER_LABELS } from "@/lib/labels";

export default function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const vendorId = id as Id<"vendors">;
  const v = useQuery(api.vendors.get, { vendorId });
  const supersede = useMutation(api.contacts.supersede);
  const addRecord = useMutation(api.contacts.addRecordContact);
  const manualEdit = useAction(api.bankAccounts.manualEdit);
  const discover = useAction(api.discovery.discoverFromWebsite);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);

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

  if (v === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (v === null) return <p className="text-sm text-red-700">Vendor not found.</p>;
  const accountById = new Map(v.accounts.map((a) => [a._id, a]));

  const recordPhones = new Set(v.contacts.filter((c) => c.kind === "phone" && c.trustLevel === "record" && !c.supersededAt).map((c) => c.value));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{v.name}</h1>
        <p className="text-sm text-muted-foreground font-mono">
          {v.domain} · onboarded {absDate(v.onboardedAt)} {v.hasPortalLogin ? "· has portal login" : ""}
        </p>
      </div>

      {editResult && (
        <Alert variant={editResult.ok ? "default" : "destructive"}>
          <AlertTitle>{editResult.ok ? "Bank account recorded as unverified" : "Edit failed"}</AlertTitle>
          <AlertDescription>
            {editResult.text}{" "}
            {editResult.caseId && (
              <Link className="underline" href={`/cases/${editResult.caseId}`}>
                Open the case →
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
          <CardDescription>
            Only a contact of record, reached on its established channel, can confirm a probe.
            {discoverMsg && <span className="block mt-1 text-amber-800">{discoverMsg}</span>}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={discovering}
              onClick={async () => {
                setDiscovering(true);
                try {
                  const r = await discover({ vendorId });
                  setDiscoverMsg(r.ok ? `Discovered ${r.phones?.length ?? 0} phone number(s) from the website (cross-check only).` : `Discovery skipped: ${r.reason}`);
                } catch (e) {
                  setDiscoverMsg(errorMessage(e));
                } finally {
                  setDiscovering(false);
                }
              }}
            >
              Discover from website (Apify)
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              Add record contact (prototype: human-attested)
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Trust</TableHead>
                <TableHead>Established</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.contacts.map((c) => (
                <TableRow key={c._id}>
                  <TableCell>{c.kind}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {c.value}
                    {c.trustLevel === "discovered" && c.kind === "phone" && (
                      <span className={`ml-2 text-xs ${recordPhones.has(c.value) ? "text-green-700" : "text-amber-700"}`}>
                        {recordPhones.has(c.value) ? "matches the phone of record" : "differs from the phone of record"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <TrustBadge level={c.trustLevel} superseded={!!c.supersededAt} />
                    {c.supersededAt && <span className="ml-2 text-xs text-muted-foreground">at {absTime(c.supersededAt)}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {absDate(c.establishedAt)} · {c.establishedVia}
                  </TableCell>
                  <TableCell className="text-right">
                    {!c.supersededAt && (
                      <Button size="xs" variant="outline" onClick={() => setSupersedeId(c._id)}>
                        Supersede
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank accounts</CardTitle>
          <CardDescription>Editing never changes a row. It creates a new unverified row and opens a case; the edited row is superseded.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>First paid</TableHead>
                <TableHead>Created via</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.accounts.map((a) => (
                <TableRow key={a._id}>
                  <TableCell>
                    <AccountStatusBadge status={a.status} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">v{a.version}</TableCell>
                  <TableCell className="font-mono text-sm">{a.routing}</TableCell>
                  <TableCell className="font-mono text-sm">…{a.accountLast4}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{absDate(a.firstPaidAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.createdVia}</TableCell>
                  <TableCell className="text-right">
                    {(a.status === "verified" || a.status === "unverified" || a.status === "probing") && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setEditing({ accountId: a._id, last4: a.accountLast4 });
                          setRouting(a.routing);
                          setAccount("");
                          setEditResult(null);
                        }}
                      >
                        Edit bank account
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent>
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
                      <TableCell className="font-mono text-sm">{i.number}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{usd(i.amountCents)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{absDate(i.dueAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{i.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        …{acct?.accountLast4 ?? "????"} {acct && <AccountStatusBadge status={acct.status} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cases</CardTitle>
          </CardHeader>
          <CardContent>
            {v.cases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cases.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {v.cases.map((c) => (
                  <li key={c._id} className="flex items-center gap-2">
                    <StateBadge state={c.state} />
                    <Link className="hover:underline" href={`/cases/${c._id}`}>
                      {TRIGGER_LABELS[c.triggerType] ?? c.triggerType}
                    </Link>
                    <span className="text-xs text-muted-foreground">{absTime(c.openedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit bank account (…{editing?.last4})</DialogTitle>
            <DialogDescription>This creates a new unverified account row and opens a verification case. The row you are editing becomes superseded. Nothing is paid to the new account until the vendor of record confirms the probe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Routing (ABA, 9 digits)</Label>
              <Input value={routing} onChange={(e) => setRouting(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Account number</Label>
              <Input value={account} onChange={(e) => setAccount(e.target.value)} className="font-mono" placeholder="new account number" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !routing || !account}
              onClick={async () => {
                if (!editing) return;
                setBusy(true);
                try {
                  const r = await manualEdit({ vendorId, routing, accountNumber: account, replacesAccountId: editing.accountId });
                  setEditResult({ ok: true, text: r.reused ? "This account already has an open case; reusing it." : "New row created as unverified; the previous row is superseded. A case was opened and a probe deposit queued.", caseId: r.caseId ?? undefined });
                  setEditing(null);
                } catch (e) {
                  setEditResult({ ok: false, text: errorMessage(e) });
                } finally {
                  setBusy(false);
                }
              }}
            >
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
              <Label>Kind</Label>
              <NativeSelect value={newKind} onChange={(e) => setNewKind(e.target.value as typeof newKind)}>
                <option value="phone">phone</option>
                <option value="portal">portal</option>
                <option value="email">email</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Value</Label>
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="+15550100099" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Attested by</Label>
              <Input value={attested} onChange={(e) => setAttested(e.target.value)} placeholder="your name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !newValue || !attested}
              onClick={async () => {
                setBusy(true);
                try {
                  await addRecord({ vendorId, kind: newKind, value: newValue, attestedBy: attested });
                  setAddOpen(false);
                  setNewValue("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
