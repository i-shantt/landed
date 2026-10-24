"use client";
import { useState } from "react";
import { FastForward as FastForwardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import { useDemoNextStep, useFastForward } from "@/lib/hooks";
import { absTime } from "@/lib/format";
import { errorMessage } from "./ReasonDialog";

// Only states where the next bank/timer step is what the demo is waiting on.
const ACTIVE = new Set(["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "PAID"]);

/** One-click "fast-forward the bank" for a case: advances the demo clock to the case's next meaningful timer. */
export function FastForward({ caseId, state }: { caseId: Id<"cases">; state: string }) {
  const next = useDemoNextStep(caseId);
  const fastForward = useFastForward();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Only offer the bank steps (probe availability, landing check). Once the case is waiting on the vendor, the
  // next timer is the SLA expiry, and a judge should not fast-forward into an escalation by accident.
  const bankStep = next && (next.kind === "probe_available" || next.kind === "landing_check");
  if (!ACTIVE.has(state) || !bankStep) return result ? <p className="text-xs text-muted-foreground" role="status">{result}</p> : null;
  return (
    <div className="space-y-1.5">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setResult(null);
          try {
            const r = await fastForward({ caseId });
            setResult(r.advanced ? `Advanced to ${absTime(r.now)}; ${r.fired} timer${r.fired === 1 ? "" : "s"} fired (${r.label}).` : `Nothing to advance: ${r.reason}`);
          } catch (e) { setResult(`Error: ${errorMessage(e)}`); }
          finally { setBusy(false); }
        }}
        aria-label={`Fast-forward the demo clock to: ${next.label}`}
      >
        <FastForwardIcon className="size-3.5" aria-hidden />
        Fast-forward the bank → {next.label}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Moves the demo clock to <span className="font-mono tabular-nums">{absTime(next.dueAt)}</span> and fires every timer due on the way. Same as the clock chip, one click.
      </p>
      {result && <p className="text-xs text-slate-700" role="status">{result}</p>}
    </div>
  );
}
