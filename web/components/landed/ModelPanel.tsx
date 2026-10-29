"use client";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModelContribution = { feature: string; value: number; contribution: number };
export type ModelPayment = { version: string; probability: number; score: number; flagged: boolean; threshold: number; contributions: ModelContribution[] };
export type ModelText = { version: string; probability: number; flagged: boolean; topTokens: { token: string; contribution: number }[]; tokens: number };

export const FEATURE_LABEL: Record<string, string> = {
  amount_log: "Amount (log)",
  hour_sin: "Hour of day (sin)",
  hour_cos: "Hour of day (cos)",
  is_off_hours: "Off hours",
  is_weekend: "Weekend",
  is_weekend_missing: "Weekday unknown",
  type_transfer: "Wire",
  type_payment: "ACH",
  type_cash_out: "Cash out",
  is_new_beneficiary: "First payment to this account",
  bene_count_24h: "Vendor payments, last 24 h",
  bene_count_7d: "Vendor payments, last 7 d",
  payer_count_24h: "Company payments, last 24 h",
  bene_amount_ratio_median: "Amount vs vendor median",
  bene_amount_ratio_missing: "Vendor baseline missing",
  payer_amount_ratio_median: "Amount vs company median",
  payer_amount_ratio_missing: "Company baseline missing",
  bene_age_days: "Vendor tenure (days)",
  is_round_amount: "Round amount",
  just_under_threshold: "Just under approval threshold",
};

export function featureLabel(name: string): string {
  return FEATURE_LABEL[name] ?? name;
}

export function formatFeatureValue(name: string, v: number): string {
  if (name === "amount_log") return `$${Math.round(Math.expm1(v)).toLocaleString("en-US")}`;
  if (name === "bene_age_days") return `${Math.round(v)} d`;
  if (name.endsWith("_ratio_median")) return `${v.toFixed(2)}×`;
  if (name.startsWith("hour_")) return v.toFixed(2);
  if (name.startsWith("is_") || name.startsWith("type_") || name.endsWith("_missing") || name === "just_under_threshold") return v ? "yes" : "no";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

const pct = (p: number) => `${Math.round(100 * p)}%`;

/** Compact badge for tables: model probability with a flagged tone. */
export function ModelBadge({ risk, className }: { risk: ModelPayment | null | undefined; className?: string }) {
  if (!risk) return null;
  const tone = risk.flagged ? "border-orange-200 bg-orange-50 text-orange-900" : risk.probability >= 0.5 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
  const top = risk.contributions.filter((c) => c.contribution > 0).slice(0, 2).map((c) => featureLabel(c.feature)).join(", ");
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[11px] tabular-nums", tone, className)} title={`Model probability ${pct(risk.probability)}${risk.flagged ? " (above the review threshold)" : ""}${top ? `. Drivers: ${top}` : ""}`} aria-label={`Model probability ${pct(risk.probability)}`}>
      <Sparkles size={11} aria-hidden />
      {pct(risk.probability)}
    </span>
  );
}

/** Signed contribution bars, largest magnitude first. */
export function ContributionBars({ contributions, max = 6 }: { contributions: ModelContribution[]; max?: number }) {
  const rows = contributions.slice(0, max);
  const scale = Math.max(0.1, ...rows.map((c) => Math.abs(c.contribution)));
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {rows.map((c) => {
        const w = Math.round((Math.abs(c.contribution) / scale) * 50);
        const pos = c.contribution > 0;
        return (
          <li key={c.feature} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-slate-900">{featureLabel(c.feature)}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatFeatureValue(c.feature, c.value)}</span>
              </div>
              <div className="relative mt-0.5 h-1.5 w-full rounded bg-slate-100">
                <div className={cn("absolute top-0 h-full rounded", pos ? "left-1/2 bg-orange-400" : "right-1/2 bg-emerald-400")} style={{ width: `${w}%` }} />
              </div>
            </div>
            <span className={cn("w-12 text-right font-mono tabular-nums", pos ? "text-orange-800" : "text-emerald-800")}>{pos ? "+" : ""}{c.contribution.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ModelSection({ payment, text, combinedScore, rulesScore }: { payment: ModelPayment | null; text: ModelText | null; combinedScore: number; rulesScore: number }) {
  if (!payment && !text) return null;
  return (
    <div className="mt-4 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium text-slate-900">
          <Sparkles size={12} aria-hidden /> Learned model
        </h4>
        <span className="text-[11px] text-muted-foreground" title="max(rules score, 100 × model probability)">
          combined {combinedScore}/100{combinedScore > rulesScore ? ` (rules ${rulesScore})` : ""}
        </span>
      </div>
      {payment && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-700">Payment that would follow this account</span>
            <span className={cn("font-mono tabular-nums", payment.flagged ? "text-orange-800" : "text-slate-900")}>
              {pct(payment.probability)}{payment.flagged ? " · above review threshold" : ""}
            </span>
          </div>
          <ContributionBars contributions={payment.contributions} />
        </div>
      )}
      {text && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-slate-700">Request email language</span>
            <span className={cn("font-mono tabular-nums", text.flagged ? "text-orange-800" : "text-slate-900")}>
              {pct(text.probability)}{text.flagged ? " · scam-like" : ""}
            </span>
          </div>
          {text.topTokens.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {text.topTokens.slice(0, 6).map((t) => (
                <span key={t.token} className={cn("rounded border px-1 font-mono text-[10px]", t.contribution > 0 ? "border-orange-200 bg-orange-50 text-orange-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")} title={`${t.contribution > 0 ? "+" : ""}${t.contribution.toFixed(2)}`}>
                  {t.token}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Logistic regression trained offline on public transaction and phishing datasets (
        <span className="font-mono">{(payment ?? text)!.version}</span>). It raises attention; it cannot release or block a payment on its own.
      </p>
    </div>
  );
}
