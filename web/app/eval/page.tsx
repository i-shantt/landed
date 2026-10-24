"use client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section, Loading, EmptyState } from "@/components/landed/primitives";
import { useEvalRuns } from "@/lib/hooks";
import { stateLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const FAMILY_LABELS: Record<string, string> = { compromised_inbox: "Compromised inbox", lookalike: "Lookalike sender", misdirection: "Misdirection", legit: "Legitimate change", recovery: "Recovery" };

type Run = { _id: string; scenarioId: string; passed?: boolean; expected: Record<string, unknown>; actual: Record<string, unknown>; metrics?: Record<string, unknown>; family?: string };

function fmtState(v: unknown) {
  return typeof v === "string" ? stateLabel(v) : v === null ? "no case" : "—";
}

export default function EvalPage() {
  const runs = useEvalRuns() as Run[] | undefined;
  const metrics = runs?.find((r) => r.scenarioId === "__metrics__");
  const rows = (runs ?? []).filter((r) => r.scenarioId !== "__metrics__");
  const families = new Map<string, Run[]>();
  for (const r of rows) {
    const fam = (r.family as string | undefined) ?? r.scenarioId.replace(/_\d+(__off)?$/, "");
    families.set(fam, [...(families.get(fam) ?? []), r]);
  }
  const m = (metrics?.metrics ?? {}) as { markdown?: string; passed?: number; total?: number };
  const lines = (m.markdown ?? "").split("\n").map((l) => l.replace(/\*\*/g, "").replace(/^- /, "").trim()).filter(Boolean);
  const disclaimer = lines.find((l) => l.startsWith("These are results"));
  return (
    <div className="space-y-4">
      <PageHeader title="Evaluation" description={disclaimer ?? "These are results on scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud."} />
      {runs === undefined ? <Loading /> : rows.length === 0 ? (
        <EmptyState title="No runs yet" description="Run the scenarios from the repo: cd eval && .venv/bin/python runner.py. Results are posted here." />
      ) : (
        <>
          {metrics && (
            <Section title="Metrics (reported, not targeted)" description={typeof m.passed === "number" ? `${m.passed} / ${m.total} scenario runs passed` : undefined}>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {lines.filter((l) => !l.startsWith("These are results") && !l.startsWith("(reported")).map((l, i) => <li key={i} className="rounded border bg-muted/40 px-2 py-1">{l}</li>)}
              </ul>
            </Section>
          )}
          {Array.from(families.entries()).map(([fam, list]) => (
            <Section key={fam} title={FAMILY_LABELS[fam] ?? fam} description={`${list.filter((r) => r.passed).length} / ${list.length} passed`}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scenario</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead className="text-right">Time to hold</TableHead>
                      <TableHead className="text-right">Human actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((r) => {
                      const mt = (r.metrics ?? {}) as { time_to_hold_ms?: number | null; human_actions?: number; extractor_off?: boolean };
                      return (
                        <TableRow key={r._id}>
                          <TableCell className="font-mono text-xs">{r.scenarioId.replace(/__off$/, "")}{mt.extractor_off && <span className="ml-1 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-900">AI off</span>}</TableCell>
                          <TableCell><span className={cn("rounded border px-1.5 text-[11px]", r.passed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800")}>{r.passed ? "pass" : "fail"}</span></TableCell>
                          <TableCell className="text-xs">{fmtState(r.expected.final_state)} · {String(r.expected.payments_created ?? 0)} payment(s)</TableCell>
                          <TableCell className="text-xs">{fmtState(r.actual.final_state)} · {String(r.actual.payments_created ?? 0)} payment(s){typeof r.actual.humanReason === "string" ? ` · ${String(r.actual.humanReason).replace(/_/g, " ")}` : ""}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{mt.time_to_hold_ms != null ? `${mt.time_to_hold_ms} ms` : "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{mt.human_actions ?? 0}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Section>
          ))}
          <p className="text-xs text-muted-foreground">Re-run: <code className="rounded bg-muted px-1 font-mono">cd eval &amp;&amp; .venv/bin/python runner.py</code></p>
        </>
      )}
    </div>
  );
}
