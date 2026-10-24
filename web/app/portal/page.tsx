"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getPortalSession, clearPortalSession } from "@/lib/portal-session";
import { absTime } from "@/lib/format";

export default function PortalHome() {
  const [session, setSession] = useState<string | null | undefined>(undefined);
  useEffect(() => setSession(getPortalSession()), []);
  const data = useQuery(api.channels.portal.openRequestsForSession, session ? { sessionToken: session } : "skip");

  if (session === undefined) return null;
  if (!session || data === null) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <p className="text-sm">You are not signed in to the vendor portal.</p>
        <Button render={<Link href="/portal/login" />}>Sign in</Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="rounded-md bg-slate-800 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">{data?.vendorName ?? "…"} payment portal (prototype)</div>
          <div className="text-xs text-slate-300">Confirmation requests from {data?.companyName ?? "your customer"}</div>
        </div>
        <Button size="sm" variant="outline" className="text-slate-900" onClick={() => { clearPortalSession(); setSession(null); }}>
          Sign out
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Open confirmation requests</CardTitle>
          <CardDescription>Each request asks you to read the exact amount of a small deposit from your bank statement.</CardDescription>
        </CardHeader>
        <CardContent>
          {!data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : data.requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to confirm right now.</p>
          ) : (
            <ul className="space-y-2">
              {data.requests.map((r) => (
                <li key={r.token} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <div>
                      New account ending <span className="font-mono">…{r.accountLast4}</span> (routing <span className="font-mono">{r.routing}</span>)
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.attemptsLeft} attempt(s) left · expires {absTime(r.expiresAt)}
                    </div>
                  </div>
                  <Button size="sm" render={<Link href={`/confirm/${r.token}`} />}>
                    Confirm deposit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
