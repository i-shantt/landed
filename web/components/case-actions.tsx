"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { ReasonDialog, errorMessage } from "@/components/reason-dialog";
import { usd } from "@/lib/format";
import { refusalLabel } from "@/lib/labels";

type Invoice = { _id: Id<"invoices">; number: string; amountCents: number; dueAt: number; status: string };

export function CaseActions({ caseId, state, openInvoices }: { caseId: Id<"cases">; state: string; openInvoices: Invoice[] }) {
  const requestReview = useMutation(api.cases.requestHumanReview);
  const markFraud = useMutation(api.cases.markFraud);
  const rejectChange = useMutation(api.cases.rejectChange);
  const send = useMutation(api.payments.send);
  const [dlg, setDlg] = useState<null | "review" | "fraud" | "reject">(null);
  const [invoiceId, setInvoiceId] = useState<string>(openInvoices[0]?._id ?? "");
  const [payResult, setPayResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = invoiceId || openInvoices[0]?._id || "";

  const canReview = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION"].includes(state);
  const canFraud = !["CLOSED", "RECOVERY", "LANDED", "VERIFIED"].includes(state);
  const canReject = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "NEEDS_HUMAN"].includes(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Human actions. The Pay button is never disabled for security; the server refuses on its own.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Pay an open invoice to this case&apos;s destination</Label>
          <div className="flex gap-2 items-center">
            <NativeSelect value={selected} onChange={(e) => setInvoiceId(e.target.value)} className="max-w-sm" disabled={openInvoices.length === 0}>
              {openInvoices.length === 0 && <option value="">No open invoice remits to this account</option>}
              {openInvoices.map((i) => (
                <option key={i._id} value={i._id}>
                  {i.number} · {usd(i.amountCents)} · {i.status}
                </option>
              ))}
            </NativeSelect>
            <Button
              disabled={busy || openInvoices.length === 0}
              onClick={async () => {
                setBusy(true);
                setPayResult(null);
                try {
                  const r = await send({ invoiceId: selected as Id<"invoices">, initiatedBy: "demo-clerk", rail: "ach" });
                  if (!r.ok) {
                    setPayResult({ ok: false, text: `Refused: ${r.reason} — ${refusalLabel(r.reason)}` });
                  } else {
                    setPayResult({ ok: true, text: `${r.duplicate ? "Already sent earlier; same payment returned" : "Payment sent"} · id ${r.paymentId}` });
                  }
                } catch (e) {
                  const reason = errorMessage(e);
                  setPayResult({ ok: false, text: `Refused: ${reason} — ${refusalLabel(reason)}` });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Pay
            </Button>
          </div>
          {payResult && (
            <Alert variant={payResult.ok ? "default" : "destructive"}>
              <AlertTitle>{payResult.ok ? "Payment accepted" : "Payment refused by the server"}</AlertTitle>
              <AlertDescription className={payResult.ok ? "" : "text-red-700 font-medium"}>{payResult.text}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canReview} onClick={() => setDlg("review")}>
            Request human review
          </Button>
          <Button variant="destructive" disabled={!canFraud} onClick={() => setDlg("fraud")}>
            Mark fraud
          </Button>
          <Button variant="outline" disabled={!canReject} onClick={() => setDlg("reject")}>
            Reject change
          </Button>
          {state === "NEEDS_HUMAN" && (
            <Button variant="outline" nativeButton={false} render={<Link href={`/exceptional-release/${caseId}`} />}>
              Exceptional release…
            </Button>
          )}
          {(state === "UNCONFIRMED" || state === "RECOVERY") && (
            <Button variant="outline" nativeButton={false} render={<Link href={`/cases/${caseId}/package`} />}>
              Recovery package →
            </Button>
          )}
        </div>

        <ReasonDialog open={dlg === "review"} onOpenChange={(o) => !o && setDlg(null)} title="Request human review" confirmLabel="Escalate" onConfirm={async (reason) => { await requestReview({ caseId, reason }); }} />
        <ReasonDialog open={dlg === "fraud"} onOpenChange={(o) => !o && setDlg(null)} title="Mark fraud" description="Marks the destination disputed, moves the case to RECOVERY, and prepares the response package." confirmLabel="Mark fraud" destructive onConfirm={async (reason) => { await markFraud({ caseId, reason }); }} />
        <ReasonDialog open={dlg === "reject"} onOpenChange={(o) => !o && setDlg(null)} title="Reject this bank change" description="The requested account is rejected; open invoices return to the previous account." confirmLabel="Reject change" onConfirm={async (reason) => { await rejectChange({ caseId, reason }); }} />
      </CardContent>
    </Card>
  );
}

export function SimulateVendorAnswer({ caseId, state }: { caseId: Id<"cases">; state: string }) {
  const settings = useQuery(api.settings.all, {});
  const answer = useMutation(api.channels.simVoice.answer);
  const [mode, setMode] = useState<"stated" | "nothing_arrived" | "no_answer">("stated");
  const [dollars, setDollars] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings || (settings.voice ?? "sim") !== "sim") return null;
  const landing = state === "PAID";
  const relevant = state === "AWAITING_CONFIRMATION" || state === "PAID" || state === "PROBE_SENT" || state === "HELD";
  if (!relevant) return null;
  return (
    <Card className="border-dashed border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="text-amber-900">Simulated vendor answer</CardTitle>
        <CardDescription>
          A human typing what the vendor sees on their bank statement. In production this is the vendor&apos;s voice or portal answer; nothing is dialed here.
          {landing ? " The case is PAID: state the full amount that landed." : " State the amount of the small deposit."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>What did the vendor see?</Label>
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-56">
              <option value="stated">An amount (enter below)</option>
              <option value="nothing_arrived">Nothing arrived</option>
              <option value="no_answer">No answer / voicemail</option>
            </NativeSelect>
          </div>
          {mode === "stated" && (
            <div className="space-y-1">
              <Label>Amount seen (USD)</Label>
              <Input value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder={landing ? "42000.00" : "0.37"} className="w-40 font-mono" />
            </div>
          )}
          <Button
            variant="outline"
            disabled={busy || (mode === "stated" && !dollars)}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              try {
                const cents = mode === "stated" ? Math.round(parseFloat(dollars) * 100) : null;
                const r = await answer({ caseId, statedAmountCents: cents, outcome: mode, mode: landing ? "landing" : "probe" });
                setResult(r.delivered ? `Delivered (${r.accepted ? "accepted by channel rules" : `not accepted: ${r.rejectReason}`}). The release gate decides next; see the timeline.` : `Stored for later: ${r.reason}`);
              } catch (e) {
                setResult(`Error: ${errorMessage(e)}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit simulated answer
          </Button>
        </div>
        {result && <p className="text-sm text-amber-900">{result}</p>}
      </CardContent>
    </Card>
  );
}
