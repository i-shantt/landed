"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Section } from "@/components/landed/primitives";
import { CaseStatusBadge } from "@/components/landed/badges";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { useCase, useCaseActions } from "@/lib/hooks";
import { humanReasonLabel } from "@/lib/labels";

export default function ExceptionalReleasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId: raw } = use(params);
  const caseId = raw as Id<"cases">;
  const c = useCase(caseId);
  const { exceptionalRelease } = useCaseActions();
  const router = useRouter();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const samePerson = !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();
  const ready = !!a.trim() && !!b.trim() && !samePerson && reason.trim().length >= 20;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Exceptional release" description={<Link href={`/cases/${caseId}`} className="hover:underline">← back to the case</Link>} />
      <Alert className="border-amber-400 bg-amber-50">
        <AlertTitle className="text-amber-900">You are overriding the verification gate.</AlertTitle>
        <AlertDescription className="text-amber-900">This marks the destination account verified without a bound confirmation from the vendor of record. Two distinct named approvers and a written reason (20+ characters) are recorded in the audit log forever. The eval counts every exceptional release as a manual intervention.</AlertDescription>
      </Alert>
      {c && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{c.vendor?.name}</span> <CaseStatusBadge state={c.state} /> {c.humanReason && <span className="text-muted-foreground">({humanReasonLabel(c.humanReason)})</span>}
        </p>
      )}
      <Section title="Approvers" description="Only possible while the case needs a human.">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="er-a">Approver A</Label>
              <Input id="er-a" value={a} onChange={(e) => setA(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="er-b">Approver B</Label>
              <Input id="er-b" value={b} onChange={(e) => setB(e.target.value)} placeholder="Full name (different person)" aria-invalid={samePerson || undefined} aria-describedby={samePerson ? "er-b-error" : undefined} />
              {samePerson && <p id="er-b-error" className="text-xs text-red-700">Approver B must be a different person from approver A.</p>}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="er-reason">Reason (min 20 characters)</Label>
            <Textarea id="er-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="e.g. Vendor CFO confirmed the account on a recorded call placed by treasury to the number on the signed contract." />
            <p className="font-mono text-xs tabular-nums text-muted-foreground">{reason.trim().length}/20</p>
          </div>
          {err && <Alert variant="destructive" role="alert"><AlertDescription>{err}</AlertDescription></Alert>}
          <Button variant="destructive" disabled={busy || !ready || c?.state !== "NEEDS_HUMAN"} onClick={() => setConfirm(true)}>Release with two approvals…</Button>
        </div>
      </Section>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm exceptional release</DialogTitle>
            <DialogDescription>{a.trim()} and {b.trim()} approve releasing this destination without a bound confirmation. This is recorded permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await exceptionalRelease({ caseId, approverA: a, approverB: b, reason }); router.push(`/cases/${caseId}`); } catch (e) { setErr(errorMessage(e)); setConfirm(false); } finally { setBusy(false); } }}>Release</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
