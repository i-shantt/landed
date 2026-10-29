"use client";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrustBandName = "new" | "building" | "established" | "trusted";

const TONE: Record<TrustBandName, string> = {
  new: "border-slate-200 bg-slate-50 text-slate-700",
  building: "border-amber-200 bg-amber-50 text-amber-900",
  established: "border-sky-200 bg-sky-50 text-sky-900",
  trusted: "border-emerald-200 bg-emerald-50 text-emerald-900",
};

export function TrustBadge({ score, band, className, title }: { score: number; band: TrustBandName; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[11px]", TONE[band], className)} title={title ?? `Beneficiary trust ${score}/100 (${band})`} aria-label={`Beneficiary trust ${score} of 100, ${band}`}>
      <ShieldCheck size={11} aria-hidden />
      <span className="font-mono tabular-nums">{score}</span>
      <span>{band}</span>
    </span>
  );
}

export function TrustComponents({ components }: { components: { id: string; points: number; evidence: string }[] }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {components.map((c) => (
        <li key={c.id} className="flex items-baseline justify-between gap-3">
          <span className="text-slate-700">{c.evidence}</span>
          <span className={cn("shrink-0 font-mono tabular-nums", c.points < 0 ? "text-red-800" : "text-slate-900")}>{c.points > 0 ? "+" : ""}{c.points}</span>
        </li>
      ))}
    </ul>
  );
}
