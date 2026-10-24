"use client";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Section } from "./primitives";
import { errorMessage } from "./ReasonDialog";
import { useExplain, useSettings } from "@/lib/hooks";

export function ExplainPanel({ caseId }: { caseId: Id<"cases"> }) {
  const settings = useSettings();
  const narrate = useExplain();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ narration: string; source: string; facts: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showFacts, setShowFacts] = useState(false);
  if (settings?.explain === "off") return null;
  return (
    <Section
      title="Explain this decision"
      description="Three sentences built only from the audit events. Every fact is checked against the timeline."
      actions={
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { setResult(await narrate({ caseId })); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } }}>
          {busy ? "Reading the timeline…" : result ? "Explain again" : "Explain"}
        </Button>
      }
    >
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      {!result && !err && <p className="text-sm text-muted-foreground">Read-only. Nothing here can change the case.</p>}
      {result && (
        <div className="space-y-2">
          <p className="text-sm text-slate-900">{result.narration}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded border px-1.5 font-mono">source: {result.source}</span>
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setShowFacts((v) => !v)} aria-expanded={showFacts}>
              {showFacts ? "Hide" : "Show"} the {result.facts.length} facts used
            </button>
          </div>
          {showFacts && <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-700">{result.facts.map((f, i) => <li key={i}>{f}</li>)}</ol>}
        </div>
      )}
    </Section>
  );
}
