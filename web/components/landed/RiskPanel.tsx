"use client";
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Section } from "@/components/landed/primitives";
import { useRisk } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type RiskTier = "low" | "elevated" | "high" | "critical";

export const RISK_TONE: Record<RiskTier, string> = {
  low: "bg-emerald-50 text-emerald-800 border-emerald-200",
  elevated: "bg-amber-50 text-amber-900 border-amber-200",
  high: "bg-orange-50 text-orange-900 border-orange-200",
  critical: "bg-red-50 text-red-800 border-red-200",
};
const RISK_BAR: Record<RiskTier, string> = {
  low: "bg-emerald-500",
  elevated: "bg-amber-500",
  high: "bg-orange-500",
  critical: "bg-red-600",
};
const RISK_LABEL: Record<RiskTier, string> = { low: "Low", elevated: "Elevated", high: "High", critical: "Critical" };
const ICON: Record<RiskTier, typeof ShieldCheck> = { low: ShieldCheck, elevated: ShieldQuestion, high: ShieldAlert, critical: ShieldX };

export function RiskBadge({ score, tier, title, className }: { score: number; tier: RiskTier; title?: string | null; className?: string }) {
  const Icon = ICON[tier];
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[11px] tabular-nums", RISK_TONE[tier], className)}
      title={title ? `${RISK_LABEL[tier]} risk, ${score}/100. Top signal: ${title}` : `${RISK_LABEL[tier]} risk, ${score}/100`}
      aria-label={`Risk ${RISK_LABEL[tier]} ${score} of 100`}
    >
      <Icon size={12} aria-hidden />
      {score}
    </span>
  );
}

export function RiskPanel({ caseId }: { caseId: Id<"cases"> }) {
  const risk = useRisk(caseId);
  if (risk === undefined) return null;
  if (risk === null) return null;
  const Icon = ICON[risk.tier];
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          Risk assessment
          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium", RISK_TONE[risk.tier])}>
            <Icon size={11} aria-hidden /> {RISK_LABEL[risk.tier]}
          </span>
        </span>
      }
      description="Deterministic signals from the stored request. Risk informs people and policy; it never releases a payment."
    >
      <div className="flex items-end justify-between gap-3">
        <div className="font-mono text-3xl tabular-nums tracking-tight text-slate-900">
          {risk.score}
          <span className="text-sm text-muted-foreground">/100</span>
        </div>
        <p className="max-w-[220px] text-right text-xs text-slate-700">{risk.recommendation}</p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={risk.score} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded", RISK_BAR[risk.tier])} style={{ width: `${Math.max(2, risk.score)}%` }} />
      </div>
      {risk.signals.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No risk signals fired. {risk.checked.length} checks ran.</p>
      ) : (
        <ul className="mt-3 divide-y text-xs">
          {risk.signals.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{s.title}</div>
                <div className="truncate text-muted-foreground" title={s.evidence}>
                  {s.evidence}
                </div>
              </div>
              <span className="shrink-0 font-mono tabular-nums text-slate-700">+{s.weight}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {risk.checked.length} checks: {risk.checked.length - risk.signals.length} clear, {risk.signals.length} fired.
      </p>
    </Section>
  );
}
