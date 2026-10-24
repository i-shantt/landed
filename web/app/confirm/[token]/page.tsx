"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePortalSession } from "@/lib/use-portal-session";
import { errorMessage } from "@/components/reason-dialog";

export default function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const session = usePortalSession();
  const info = useQuery(api.channels.portal.tokenInfo, session ? { sessionToken: session, token } : "skip");
  const confirm = useMutation(api.channels.portal.confirm);
  const [dollars, setDollars] = useState("");
  const [nothing, setNothing] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "wrong" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (session === undefined) return null;
  if (!session || (info && info.error === "not_logged_in")) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <p className="text-sm">Please sign in to the vendor portal first.</p>
        <Button render={<Link href="/portal/login" />}>Sign in</Button>
      </div>
    );
  }
  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (info.error) return <p className="text-sm text-red-700">This confirmation request was not found for your account.</p>;

  const done = info.usedAt !== null || info.caseState !== "AWAITING_CONFIRMATION";
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-md bg-slate-800 text-white px-4 py-3">
        <div className="text-lg font-semibold">{info.vendorName} payment portal (prototype)</div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Confirm the test deposit</CardTitle>
          <CardDescription>
            Enter the exact amount {info.companyName} deposited to your account ending {info.accountLast4} today.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {done ? (
            <Alert>
              <AlertTitle>{info.caseState === "VERIFIED" || info.caseState === "PAID" || info.caseState === "LANDED" || info.caseState === "CLOSED" ? "Account verified" : "This request is closed"}</AlertTitle>
              <AlertDescription>
                {info.caseState === "NEEDS_HUMAN" ? "The request has been escalated to a human at the paying company." : `Case state: ${info.caseState}.`}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-1">
                <Label>Amount (USD)</Label>
                <Input value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="0.37" className="font-mono" disabled={nothing} inputMode="decimal" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nothing} onChange={(e) => setNothing(e.target.checked)} />
                No deposit from {info.companyName} appears on my statement
              </label>
              <p className="text-xs text-muted-foreground">{info.attemptsLeft} attempt(s) left.</p>
              <Button
                disabled={busy || (!nothing && !dollars)}
                onClick={async () => {
                  setBusy(true);
                  setResult(null);
                  try {
                    const cents = nothing ? null : Math.round(parseFloat(dollars) * 100);
                    const r = await confirm({ sessionToken: session, token, statedAmountCents: cents });
                    if (r.verified) setResult({ kind: "ok", text: "Thank you. The account is now verified for payments." });
                    else setResult({ kind: "wrong", text: r.attemptsLeft > 0 ? `That did not match. ${r.attemptsLeft} attempt(s) left.` : "No attempts left. The request has been escalated to a human." });
                  } catch (e) {
                    setResult({ kind: "error", text: errorMessage(e) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Submit
              </Button>
            </>
          )}
          {result && (
            <Alert variant={result.kind === "ok" ? "default" : "destructive"}>
              <AlertDescription>{result.text}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      <Link href="/portal" className="text-sm text-muted-foreground hover:underline">
        ← all requests
      </Link>
    </div>
  );
}
