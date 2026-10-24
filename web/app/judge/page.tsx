"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { CheckCircle2, XCircle, Circle, Loader2, MinusCircle } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, Loading, EmptyState } from "@/components/landed/primitives";
import { CaseStatusBadge } from "@/components/landed/badges";
import { CaseTimeline, type TimelineEvent } from "@/components/landed/CaseTimeline";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { useJudgeScenarios, useJudgeRun, useJudgeRecent, useJudgeActions, useSettings, useCaseEvents, useNow } from "@/lib/hooks";
import { stateLabel } from "@/lib/labels";
import { absTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const FAMILY_LABELS: Record<string, string> = { custom: "Custom templates", compromised_inbox: "Compromised inbox", lookalike: "Lookalike sender", misdirection: "Misdirection", legit: "Legitimate change", recovery: "Recovery" };
const FAMILY_ORDER = ["custom", "compromised_inbox", "lookalike", "misdirection", "legit", "recovery"];
const STEP_LABELS: Record<string, string> = {
  inject: "Email arrives", manual_edit: "Clerk edits the account", expect_case: "Check case state", advance_to: "Advance the clock to the next timer", advance: "Advance the clock",
  vendor_statement: "Vendor of record answers", landing_statement: "Vendor confirms what landed", expect_confirmation: "Check how the statement was treated", pay: "Click Pay", expect_pay: "Check the guard's answer",
  craft_invoice: "Create an invoice", create_vendor: "Create a vendor", portal_confirm: "Vendor confirms in the portal", set_setting: "Change a setting", expect_account: "Check account status", mark_fraud: "Human marks fraud", expect_package: "Wait for the recovery package",
};

type StepView = { name: string; status: "pending" | "running" | "ok" | "fail" | "skipped"; note?: string };

function StepIcon({ status }: { status: StepView["status"] }) {
  if (status === "ok") return <CheckCircle2 className="size-4 text-emerald-700" aria-label="ok" />;
  if (status === "fail") return <XCircle className="size-4 text-red-700" aria-label="failed" />;
  if (status === "running") return <Loader2 className="size-4 animate-spin text-blue-800 motion-reduce:animate-none" aria-label="running" />;
  if (status === "skipped") return <MinusCircle className="size-4 text-slate-400" aria-label="skipped" />;
  return <Circle className="size-4 text-slate-300" aria-label="pending" />;
}

export default function JudgePage() {
  return (
    <Suspense fallback={<Loading />}>
      <JudgeView />
    </Suspense>
  );
}

function JudgeView() {
  const scenarios = useJudgeScenarios();
  const settings = useSettings();
  const recent = useJudgeRecent();
  const { run } = useJudgeActions();
  const [runId, setRunId] = useState<string | null>(null);
  const [aiOff, setAiOff] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = useJudgeRun(runId);
  const off = settings?.judgeMode === "off";

  if (scenarios === undefined) return <Loading />;
  const families = new Map<string, typeof scenarios>();
  for (const s of scenarios) families.set(s.family, [...(families.get(s.family) ?? []), s]);
  const ordered = Array.from(families.entries()).sort((a, b) => FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]));

  async function start(id: string) {
    setBusy(id); setErr(null);
    try {
      const r = await run({ scenarioId: id, extractorOff: !!aiOff[id] });
      setRunId(r.runId);
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Judge mode" description="Run any scripted scenario against this deployment and watch the case unfold. Try your own in the Mailbox; this page runs the eval's steps for you.">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">Running a scenario re-seeds the demo database first. Open cases from a previous run disappear.</p>
      </PageHeader>
      {off && <p className="text-sm text-red-700">Judge mode is off (settings key judgeMode).</p>}
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {ordered.map(([fam, list]) => (
            <Section key={fam} title={FAMILY_LABELS[fam] ?? fam} description={`${list.length} scenario${list.length === 1 ? "" : "s"}`}>
              <ul className="divide-y">
                {list.map((s) => {
                  const hasInject = s.steps.includes("inject");
                  return (
                    <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs">{s.id}</span>
                          <span className="text-xs text-muted-foreground">{s.steps.length} steps</span>
                        </div>
                        {s.description && <p className="mt-0.5 text-sm text-slate-700">{s.description}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Expected: {typeof s.expect.final_state === "string" ? stateLabel(s.expect.final_state as string) : "no case"} · {String(s.expect.payments_created ?? 0)} payment(s)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasInject && (
                          <label className="flex items-center gap-1 text-xs text-slate-700">
                            <input type="checkbox" checked={!!aiOff[s.id]} onChange={(e) => setAiOff({ ...aiOff, [s.id]: e.target.checked })} aria-label={`Run ${s.id} with the AI off`} />
                            AI off
                          </label>
                        )}
                        <Button size="sm" disabled={off || busy !== null || (current !== undefined && current !== null && current.actual?.status !== "done" && runId !== null)} onClick={() => start(s.id)}>
                          {busy === s.id ? "Starting…" : "Run"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}
        </div>

        <div className="space-y-4 xl:sticky xl:top-16 xl:self-start">
          {runId && current === undefined && <Loading label="Starting run…" />}
          {current && <RunView run={current} />}
          {!runId && (
            <EmptyState title="No run in progress" description="Pick a scenario on the left. Steps, the case link and the live timeline appear here." />
          )}
          <Section title="Recent runs">
            {!recent || recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.map((r) => (
                  <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <button type="button" className="font-mono text-xs underline-offset-2 hover:underline" onClick={() => setRunId(r.scenarioId.replace(/^judge:/, ""))}>
                      {String((r.actual as { scenarioId?: string })?.scenarioId ?? r.scenarioId)}
                      {(r.actual as { extractorOff?: boolean })?.extractorOff && <span className="ml-1 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-900">AI off</span>}
                    </button>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">{absTime(r.startedAt)}</span>
                      {r.finishedAt ? <span className={cn("rounded border px-1.5 text-[11px]", r.passed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800")}>{r.passed ? "pass" : "fail"}</span> : <span className="text-[11px]">running</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

type RunRow = { scenarioId: string; startedAt: number; finishedAt?: number; passed?: boolean; expected: Record<string, unknown>; actual: Record<string, unknown> };

function RunView({ run }: { run: RunRow }) {
  const a = run.actual as { scenarioId?: string; extractorOff?: boolean; caseId?: string | null; steps?: StepView[]; failures?: string[]; status?: string; final_state?: string | null };
  const done = a.status === "done" || !!run.finishedAt;
  const caseId = (a.caseId ?? null) as Id<"cases"> | null;
  return (
    <>
      <Section
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm">{a.scenarioId}</span>{a.extractorOff && <span className="rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-900">AI off</span>}</span>}
        description={done ? (run.passed ? "Finished: every expectation held." : "Finished with failures.") : "Running against this deployment…"}
        actions={done ? <span className={cn("rounded border px-2 py-0.5 text-xs font-semibold", run.passed ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800")}>{run.passed ? "PASS" : "FAIL"}</span> : undefined}
      >
        <ol className="space-y-1.5">
          {(a.steps ?? []).map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0"><StepIcon status={s.status} /></span>
              <div className="min-w-0">
                <span className={cn(s.status === "pending" && "text-muted-foreground")}>{STEP_LABELS[s.name] ?? s.name}</span>
                {s.note && <span className="ml-2 text-xs text-muted-foreground">{s.note}</span>}
              </div>
            </li>
          ))}
        </ol>
        {caseId && (
          <p className="mt-3 text-sm">
            Case: <Link href={`/cases/${caseId}`} className="font-mono text-xs underline">{caseId}</Link>
            {a.final_state && <> · <CaseStatusBadge state={a.final_state} /></>}
          </p>
        )}
        {done && a.failures && a.failures.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-800">{a.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
      </Section>
      {caseId && <LiveTimeline caseId={caseId} />}
    </>
  );
}

function LiveTimeline({ caseId }: { caseId: Id<"cases"> }) {
  const events = useCaseEvents(caseId, true);
  const now = useNow();
  return (
    <Section title="Live case timeline" description="Updates as the run proceeds.">
      {events === undefined ? <Loading /> : <CaseTimeline events={events as TimelineEvent[]} now={now} />}
    </Section>
  );
}
