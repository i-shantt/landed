"use client";
import { use, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Section, Loading } from "@/components/landed/primitives";
import { PortalFrame } from "@/components/landed/PortalFrame";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { usePortalToken, usePortalActions } from "@/lib/hooks";
import { usePortalSession } from "@/lib/use-portal-session";
import { stateLabel } from "@/lib/labels";

export default function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const session = usePortalSession();
  const info = usePortalToken(session, token);
  const { confirm } = usePortalActions();
  const [dollars, setDollars] = useState("");
  const [nothing, setNothing] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "wrong" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (session === undefined) return null;
  if (!session || (info && info.error === "not_logged_in")) {
    return (
      <PortalFrame vendorName="Vendor">
        <p className="text-sm">Please sign in to the vendor portal first.</p>
        <Button nativeButton={false} render={<Link href="/portal/login" />}>Sign in</Button>
      </PortalFrame>
    );
  }
  if (!info) return <Loading />;
  if (info.error) return <PortalFrame vendorName="Vendor"><p className="text-sm text-red-700" role="alert">This confirmation request was not found for your account.</p></PortalFrame>;

  const done = info.usedAt !== null || info.caseState !== "AWAITING_CONFIRMATION";
  const verified = ["VERIFIED", "PAID", "LANDED", "CLOSED"].includes(info.caseState ?? "");
  return (
    <PortalFrame vendorName={info.vendorName}>
      <Section title="Confirm the test deposit" description={`Enter the exact amount ${info.companyName} deposited to your account ending ${info.accountLast4} today.`}>
        {done ? (
          <Alert role="status">
            <AlertTitle>{verified ? "Account verified" : "This request is closed"}</AlertTitle>
            <AlertDescription>{info.caseState === "NEEDS_HUMAN" ? "The request has been escalated to a human at the paying company." : `Case status: ${stateLabel(info.caseState ?? "")}.`}</AlertDescription>
          </Alert>
        ) : (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault(); setBusy(true); setResult(null);
            try {
              const cents = nothing ? null : Math.round(parseFloat(dollars) * 100);
              const r = await confirm({ sessionToken: session, token, statedAmountCents: cents });
              if (r.verified) setResult({ kind: "ok", text: "Thank you. The account is now verified for payments." });
              else setResult({ kind: "wrong", text: r.attemptsLeft > 0 ? `That did not match. ${r.attemptsLeft} attempt(s) left.` : "No attempts left. The request has been escalated to a human." });
            } catch (er) { setResult({ kind: "error", text: errorMessage(er) }); }
            finally { setBusy(false); }
          }}>
            <div className="space-y-1">
              <Label htmlFor="cf-amount">Amount (USD)</Label>
              <Input id="cf-amount" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="0.37" className="font-mono" disabled={nothing} inputMode="decimal" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={nothing} onChange={(e) => setNothing(e.target.checked)} />
              No deposit from {info.companyName} appears on my statement
            </label>
            <p className="text-xs text-muted-foreground">{info.attemptsLeft} attempt(s) left.</p>
            <Button type="submit" disabled={busy || (!nothing && !dollars)}>Submit</Button>
          </form>
        )}
        {result && (
          <Alert variant={result.kind === "ok" ? "default" : "destructive"} className="mt-3" role="status">
            <AlertDescription>{result.text}</AlertDescription>
          </Alert>
        )}
      </Section>
      <Link href="/portal" className="text-sm text-muted-foreground hover:underline">← all requests</Link>
    </PortalFrame>
  );
}
