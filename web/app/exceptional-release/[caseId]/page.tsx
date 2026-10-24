"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StateBadge } from "@/components/state-badge";
import { errorMessage } from "@/components/reason-dialog";
import { humanReasonLabel } from "@/lib/labels";

export default function ExceptionalReleasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId: raw } = use(params);
  const caseId = raw as Id<"cases">;
  const c = useQuery(api.cases.get, { caseId });
  const release = useMutation(api.cases.exceptionalRelease);
  const router = useRouter();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Exceptional release</h1>
        <Link href={`/cases/${caseId}`} className="text-sm text-muted-foreground hover:underline">
          ← back to the case
        </Link>
      </div>
      <Alert className="border-amber-400 bg-amber-50">
        <AlertTitle className="text-amber-900">You are overriding the verification gate.</AlertTitle>
        <AlertDescription className="text-amber-900">
          This marks the destination account verified without a bound confirmation from the vendor of record. Two distinct named approvers and a written reason (20+ characters) are recorded in the audit log forever. The eval counts every exceptional release as a manual intervention.
        </AlertDescription>
      </Alert>
      {c && (
        <p className="text-sm flex items-center gap-2">
          {c.vendor?.name} <StateBadge state={c.state} /> {c.humanReason && <span className="text-muted-foreground">({humanReasonLabel(c.humanReason)})</span>}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Approvers</CardTitle>
          <CardDescription>Only possible while the case is NEEDS_HUMAN.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Approver A</Label>
              <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1">
              <Label>Approver B</Label>
              <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="Full name (different person)" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Reason (min 20 characters)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="e.g. Vendor CFO confirmed the account on a recorded call placed by treasury to the number on the signed contract." />
            <p className="text-xs text-muted-foreground">{reason.trim().length}/20</p>
          </div>
          {err && (
            <Alert variant="destructive">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="destructive"
            disabled={busy || !a.trim() || !b.trim() || reason.trim().length < 20}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await release({ caseId, approverA: a, approverB: b, reason });
                router.push(`/cases/${caseId}`);
              } catch (e) {
                setErr(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Release with two approvals
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
