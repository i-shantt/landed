"use client";
import { useState } from "react";
import { Clock3 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useClock, useClockControls, useNextTimers } from "@/lib/hooks";
import { absTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HOUR = 3_600_000;

/** Clock controls shared by the top-bar sheet and the Settings page. */
export function ClockControls({ onDone }: { onDone?: (msg: string) => void }) {
  const clock = useClock();
  const next = useNextTimers();
  const { advance, advanceTo, setMode } = useClockControls();
  const [msg, setMsg] = useState<string | null>(null);
  const say = (m: string) => { setMsg(m); onDone?.(m); };
  async function jump(kind: "probe_settle" | "probe_available") {
    const t = next?.[kind];
    if (!t) return say(`No pending ${kind === "probe_settle" ? "ACH settlement" : "availability"} timer.`);
    const r = await advanceTo({ at: t.dueAt + 1000 });
    say(`Advanced to ${absTime(r.now)}; fired ${r.fired} timer(s).`);
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono tabular-nums text-base">{clock ? absTime(clock.now) : "…"}</span>
        <span className={cn("rounded border px-1.5 text-[11px]", clock?.mode === "demo" ? "border-indigo-200 bg-indigo-50 text-indigo-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>{clock?.mode === "demo" ? "demo clock" : "live clock"}</span>
        {clock && <span className="text-xs text-muted-foreground">offset {Math.round((clock.offsetMs / HOUR) * 10) / 10}h</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={async () => { const r = await advance({ ms: HOUR }); say(`+1h → ${absTime(r.now)}; fired ${r.fired}.`); }}>+1 hour</Button>
        <Button variant="outline" size="sm" onClick={async () => { const r = await advance({ ms: 24 * HOUR }); say(`+1 business day (24h) → ${absTime(r.now)}; fired ${r.fired}.`); }}>+1 business day</Button>
        <Button variant="outline" size="sm" disabled={!next?.probe_settle} onClick={() => jump("probe_settle")}>Jump to next ACH window</Button>
        <Button variant="outline" size="sm" disabled={!next?.probe_available} onClick={() => jump("probe_available")}>Jump to availability</Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {next && Object.keys(next).length === 0 && <dd className="col-span-2">No pending timers.</dd>}
        {next && Object.entries(next).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono">{k}</dt>
            <dd className="font-mono tabular-nums">{absTime(v.dueAt)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="xs" onClick={() => setMode({ mode: clock?.mode === "demo" ? "live" : "demo" })}>
          Switch to {clock?.mode === "demo" ? "live" : "demo"} clock
        </Button>
      </div>
      {msg && <p className="text-xs text-slate-700" role="status">{msg}</p>}
    </div>
  );
}

export function ClockChip() {
  const clock = useClock();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open clock controls"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-xs hover:bg-muted"
      >
        <Clock3 className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-mono tabular-nums">{clock ? absTime(clock.now) : "…"}</span>
        <span className={cn("rounded px-1 text-[10px]", clock?.mode === "demo" ? "bg-indigo-50 text-indigo-900" : "bg-emerald-50 text-emerald-900")}>{clock?.mode ?? "…"}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="p-5">
          <SheetHeader className="p-0">
            <SheetTitle>Demo clock</SheetTitle>
            <SheetDescription>All case timers run on this clock. Advancing it fires due timers immediately.</SheetDescription>
          </SheetHeader>
          <ClockControls />
        </SheetContent>
      </Sheet>
    </>
  );
}
