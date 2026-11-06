"use client";
import Link from "next/link";
import { Scale } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Section } from "@/components/landed/primitives";
import { useCaseEvents, useRisk, useScreeningForVendor, useVendorTrust } from "@/lib/hooks";
import { ACTION_LABELS, FIT_LABELS, decisionHelper, type DecisionInput, type Fit, type Tone } from "@/lib/decision";
import { cn } from "@/lib/utils";

const FIT_TONE: Record<Fit, string> = {
  recommended: "bg-emerald-50 text-emerald-800 border-emerald-200",
  possible: "bg-amber-50 text-amber-900 border-amber-200",
  discouraged: "bg-slate-50 text-slate-600 border-slate-200",
};
const FACT_TONE: Record<Tone, string> = { neutral: "text-slate-700", good: "text-emerald-800", warn: "text-amber-900", bad: "text-red-800" };

/**
 * Shown above the case actions while a case sits in NEEDS_HUMAN. Reads what the page already loads (risk, screening,
 * trust, statements, the escalation payload) and orders the three human exits with a reason for each. It changes
 * nothing: the buttons it points at are the same ones in "Case actions", and the guard still decides what pays.
 */
export function DecisionHelper({
  caseId,
  vendorId,
  reason,
  confirmations,
  amountAtStakeCents,
}: {
  caseId: Id<"cases">;
  vendorId: Id<"vendors"> | null;
  reason: string | null;
  confirmations: { accepted: boolean }[] | undefined;
  amountAtStakeCents: number;
}) {
  const risk = useRisk(caseId);
  const screening = useScreeningForVendor(vendorId);
  const trust = useVendorTrust(vendorId);
  const events = useCaseEvents(caseId);
  const escalated = (events ?? []).find((e) => e.type === "escalated") as { payload?: { otherVendors?: number } } | undefined;
  const input: DecisionInput = {
    reason,
    risk: risk ? { score: risk.score, tier: risk.tier, signals: risk.signals.map((s) => ({ title: s.title })) } : null,
    screening: screening?.latest?.status ?? "unknown",
    trustBand: trust?.band ?? null,
    confirmations: {
      accepted: (confirmations ?? []).filter((c) => c.accepted).length,
      rejected: (confirmations ?? []).filter((c) => !c.accepted).length,
    },
    otherVendors: typeof escalated?.payload?.otherVendors === "number" ? escalated.payload.otherVendors : null,
    amountAtStakeCents,
  };
  const d = decisionHelper(input);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Scale size={14} aria-hidden /> Decision helper
        </span>
      }
      description="Orders the three human exits from what this case shows. It recommends; a person decides, and payments stay blocked either way."
      className="border-amber-200"
    >
      <p className="text-sm font-medium text-slate-900">{d.headline}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {d.facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className={cn("min-w-0 break-words", FACT_TONE[f.tone])}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded border border-dashed bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <span className="font-medium">Before deciding:</span> {d.nextStep}
      </p>
      <ol className="mt-3 divide-y text-xs" aria-label="Options">
        {d.options.map((o) => (
          <li key={o.action} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{ACTION_LABELS[o.action]}</span>
                <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", FIT_TONE[o.fit])}>{FIT_LABELS[o.fit]}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{o.why}</p>
            </div>
            {o.action === "exceptional_release" ? (
              <Link href={`/exceptional-release/${caseId}`} className="shrink-0 underline">
                Open →
              </Link>
            ) : (
              <a href="#case-actions" className="shrink-0 underline">
                Go to actions ↓
              </a>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}
