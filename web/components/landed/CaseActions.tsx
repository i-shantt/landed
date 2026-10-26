"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Id } from "@/convex/_generated/dataModel";
import { NativeSelect } from "@/components/native-select";
import { RefusalAlert } from "./RefusalAlert";
import { ReasonDialog, errorMessage } from "./ReasonDialog";
import { Section } from "./primitives";
import { useCaseActions, useSettings } from "@/lib/hooks";
import { usd } from "@/lib/format";
import { INVOICE_STATUS_LABELS } from "@/lib/labels";

type Invoice = {
  _id: Id<"invoices">;
  number: string;
  amountCents: number;
  dueAt: number;
  status: string;
};

export function CaseActions({
  caseId,
  state,
  openInvoices,
}: {
  caseId: Id<"cases">;
  state: string;
  openInvoices: Invoice[];
}) {
  const { pay, requestReview, markFraud, rejectChange } = useCaseActions();
  const [dlg, setDlg] = useState<null | "review" | "fraud" | "reject">(null);
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [payResult, setPayResult] = useState<
    { ok: true; text: string } | { ok: false; reason: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  // Fall back to the first open invoice whenever the remembered selection is no longer open
  // (it was just paid, or the case re-rendered with a different invoice set).
  const selected =
    (invoiceId && openInvoices.some((i) => i._id === invoiceId) ? invoiceId : "") ||
    openInvoices[0]?._id ||
    "";
  const canReview = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION"].includes(
    state,
  );
  const canFraud = !["CLOSED", "RECOVERY", "LANDED", "VERIFIED"].includes(
    state,
  );
  const canReject = [
    "HELD",
    "PROBE_SENT",
    "AWAITING_CONFIRMATION",
    "NEEDS_HUMAN",
  ].includes(state);

  return (
    <Section title="Case actions">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pay-invoice">
            Pay an open invoice to this case&apos;s destination
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              id="pay-invoice"
              value={selected}
              onChange={(e) => setInvoiceId(e.target.value)}
              className="max-w-sm"
              disabled={openInvoices.length === 0}
            >
              {openInvoices.length === 0 && (
                <option value="">No open invoice remits to this account</option>
              )}
              {openInvoices.map((i) => (
                <option key={i._id} value={i._id}>
                  {i.number} · {usd(i.amountCents)} ·{" "}
                  {INVOICE_STATUS_LABELS[i.status] ?? i.status}
                </option>
              ))}
            </NativeSelect>
            <Button
              disabled={busy || openInvoices.length === 0}
              onClick={async () => {
                setBusy(true);
                setPayResult(null);
                try {
                  const r = await pay({
                    invoiceId: selected as Id<"invoices">,
                    initiatedBy: "demo-clerk",
                    rail: "ach",
                  });
                  if (!r.ok) setPayResult({ ok: false, reason: r.reason });
                  else {
                    setPayResult({
                      ok: true,
                      text: `${r.duplicate ? "Already sent earlier; the same payment was returned" : "Payment sent"} · ${r.paymentId}`,
                    });
                    setInvoiceId("");
                  }
                } catch (e) {
                  setPayResult({ ok: false, reason: errorMessage(e) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Pay
            </Button>
          </div>
          {payResult &&
            (payResult.ok ? (
              <Alert role="status">
                <AlertTitle>Payment accepted</AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  {payResult.text}
                </AlertDescription>
              </Alert>
            ) : (
              <RefusalAlert reason={payResult.reason} />
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canReview}
            onClick={() => setDlg("review")}
          >
            Request human review
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canReject}
            onClick={() => setDlg("reject")}
          >
            Reject change
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canFraud}
            onClick={() => setDlg("fraud")}
          >
            Mark fraud
          </Button>
          {state === "NEEDS_HUMAN" && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/exceptional-release/${caseId}`} />}
            >
              Exceptional release…
            </Button>
          )}
          {(state === "UNCONFIRMED" || state === "RECOVERY") && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/cases/${caseId}/package`} />}
            >
              Recovery package →
            </Button>
          )}
        </div>
        <p className="border-t pt-2 text-xs text-muted-foreground">
          The agent cannot verify, pay, release, or edit contacts.{" "}
          <Link href="/about#permissions" className="underline">
            What the agent cannot do →
          </Link>
        </p>
      </div>
      <ReasonDialog
        open={dlg === "review"}
        onOpenChange={(o) => !o && setDlg(null)}
        title="Request human review"
        confirmLabel="Escalate"
        onConfirm={async (reason) => {
          await requestReview({ caseId, reason });
        }}
      />
      <ReasonDialog
        open={dlg === "fraud"}
        onOpenChange={(o) => !o && setDlg(null)}
        title="Mark fraud"
        description="Marks the destination disputed, moves the case to Recovery, and prepares the response package."
        confirmLabel="Mark fraud"
        destructive
        onConfirm={async (reason) => {
          await markFraud({ caseId, reason });
        }}
      />
      <ReasonDialog
        open={dlg === "reject"}
        onOpenChange={(o) => !o && setDlg(null)}
        title="Reject this bank change"
        description="The requested account is rejected; open invoices return to the previous account."
        confirmLabel="Reject change"
        onConfirm={async (reason) => {
          await rejectChange({ caseId, reason });
        }}
      />
    </Section>
  );
}

export function SimulateVendorAnswer({
  caseId,
  state,
}: {
  caseId: Id<"cases">;
  state: string;
}) {
  const settings = useSettings();
  const { simAnswer } = useCaseActions();
  const [mode, setMode] = useState<"stated" | "nothing_arrived" | "no_answer">(
    "stated",
  );
  const [dollars, setDollars] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!settings || (settings.voice ?? "sim") !== "sim") return null;
  const landing = state === "PAID";
  // Only meaningful once the vendor can see the probe (AWAITING_CONFIRMATION) or the payment (PAID).
  if (!["AWAITING_CONFIRMATION", "PAID"].includes(state)) return null;
  return (
    <Section
      className="border-amber-300 bg-amber-50/40"
      title={<span className="text-amber-900">Simulated vendor answer</span>}
      description={`A human typing what the vendor sees on their bank statement. In production this is the vendor's voice or portal answer; nothing is dialed here. ${landing ? "The case is paid: state the full amount that landed." : "State the amount of the small deposit."}`}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="sim-mode">What did the vendor see?</Label>
          <NativeSelect
            id="sim-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="w-56"
          >
            <option value="stated">An amount (enter below)</option>
            <option value="nothing_arrived">Nothing arrived</option>
            <option value="no_answer">No answer / voicemail</option>
          </NativeSelect>
        </div>
        {mode === "stated" && (
          <div className="space-y-1">
            <Label htmlFor="sim-amount">Amount seen (USD)</Label>
            <Input
              id="sim-amount"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              placeholder={landing ? "42000.00" : "0.37"}
              className="w-40 font-mono"
              inputMode="decimal"
            />
          </div>
        )}
        <Button
          variant="outline"
          disabled={busy || (mode === "stated" && !dollars)}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              const cents =
                mode === "stated"
                  ? Math.round(parseFloat(dollars) * 100)
                  : null;
              const r = await simAnswer({
                caseId,
                statedAmountCents: cents,
                outcome: mode,
                mode: landing ? "landing" : "probe",
              });
              setResult(
                r.delivered
                  ? `Delivered (${r.accepted ? "accepted by channel rules" : `not accepted: ${r.rejectReason}`}). The release gate decides next; see the timeline.`
                  : `Stored for later: ${r.reason}`,
              );
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
      {result && (
        <p className="mt-2 text-xs text-amber-900" role="status">
          {result}
        </p>
      )}
    </Section>
  );
}
