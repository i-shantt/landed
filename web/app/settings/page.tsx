"use client";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { absTime } from "@/lib/format";
import { errorMessage } from "@/components/reason-dialog";

const HOUR = 3_600_000;

export default function SettingsPage() {
  const clock = useQuery(api.clock.get, {});
  const settings = useQuery(api.settings.all, {});
  const nextDue = useQuery(api.timers.nextDue, {});
  const seedStatus = useQuery(api.seed.status, {});
  const advance = useMutation(api.clock.advance);
  const advanceTo = useMutation(api.clock.advanceTo);
  const setMode = useMutation(api.clock.setMode);
  const setSetting = useMutation(api.settings.set);
  const reseed = useAction(api.seed.reseed);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function jump(kind: "ach" | "avail") {
    if (!nextDue) {
      setMsg("No pending timer.");
      return;
    }
    const target = kind === "ach" ? nextDue : nextDue;
    const r = await advanceTo({ at: target.dueAt + 1000 });
    setMsg(`Advanced to ${absTime(r.now)}; fired ${r.fired} timer(s) (${target.kind}).`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Clock controls, extractor toggle, and what is simulated.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clock</CardTitle>
          <CardDescription>All case timers run on this clock. Advancing it fires due timers immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="outline">{clock?.mode ?? "…"}</Badge>
            <span className="font-mono">{clock ? absTime(clock.now) : "…"}</span>
            {clock && <span className="text-xs text-muted-foreground">offset {Math.round(clock.offsetMs / HOUR * 10) / 10}h</span>}
            <Button size="xs" variant="outline" onClick={() => setMode({ mode: clock?.mode === "demo" ? "live" : "demo" })}>
              switch to {clock?.mode === "demo" ? "live" : "demo"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={async () => { const r = await advance({ ms: HOUR }); setMsg(`+1h → ${absTime(r.now)}; fired ${r.fired}`); }}>
              +1 hour
            </Button>
            <Button variant="outline" onClick={async () => { const r = await advance({ ms: 24 * HOUR }); setMsg(`+1 business day (24h) → ${absTime(r.now)}; fired ${r.fired}`); }}>
              +1 business day (24h)
            </Button>
            <Button variant="outline" disabled={!nextDue} onClick={() => jump("ach")}>
              Jump to next ACH window
            </Button>
            <Button variant="outline" disabled={!nextDue} onClick={() => jump("avail")}>
              Jump to availability
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Next pending timer: {nextDue ? `${nextDue.kind} at ${absTime(nextDue.dueAt)}` : "none"}. Both jump buttons advance to the next pending timer; press again for the one after.
          </p>
          {msg && <p className="text-sm">{msg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extractor</CardTitle>
          <CardDescription>Which intake extractor reads inbound email. &quot;off&quot; is the AI-miss demo: the guard still refuses unverified destinations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            {(["claude", "rules", "off"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="extractor" checked={(settings?.extractorMode ?? "rules") === m} onChange={() => setSetting({ key: "extractorMode", value: m })} />
                {m}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">If ANTHROPIC_API_KEY is unset on the deployment, &quot;claude&quot; falls back to rules and logs it.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What is real vs. simulated</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>
            Bank rail: <Badge variant="outline">{settings?.rail ?? "sim"}</Badge> {settings?.rail === "nessie" ? "(Capital One Nessie sandbox)" : "(SimRail, in-memory ledger)"}
          </div>
          <div>
            Voice channel: <Badge variant="outline">{settings?.voice ?? "sim"}</Badge> {settings?.voice === "vapi" ? "(Vapi, test numbers only)" : "(SimVoice: a human types the vendor's answer)"}
          </div>
          <div>
            Seeded: {seedStatus?.seeded ? `${seedStatus.companyName}, ${seedStatus.vendorCount} vendors` : "no"} {settings?.seededAt ? `at ${absTime(Number(settings.seededAt))}` : ""}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vendor portal demo</CardTitle>
          <CardDescription>Open the vendor login in a second tab and act as the vendor. Credentials: vendor slug / landed-demo.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<a href="/portal/login" target="_blank" rel="noreferrer" />}>
            Portal demo: open as vendor ↗
          </Button>
        </CardContent>
      </Card>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-800">Re-seed fixtures</CardTitle>
          <CardDescription>Deletes every table and reloads the fixtures. Dangerous.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirm(true)}>
            Re-seed fixtures…
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete everything and re-seed?</DialogTitle>
            <DialogDescription>All cases, messages, payments and settings are wiped. The clock resets to demo time, offset 0.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await reseed({});
                  setMsg(`Re-seeded (deleted ${r.deleted} rows).`);
                  setConfirm(false);
                } catch (e) {
                  setMsg(`Error: ${errorMessage(e)}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Yes, re-seed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
