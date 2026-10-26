"use client";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  stateLabel,
  accountStatusLabel,
  trustLabel,
  TRUST_TOOLTIPS,
  LANDING_LABELS,
  INVOICE_STATUS_LABELS,
  PROBE_STATE_LABELS,
  channelLabel,
} from "@/lib/labels";

export const TONE = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  amber: "bg-amber-50 text-amber-900 border-amber-200",
  red: "bg-red-50 text-red-800 border-red-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
  blue: "bg-slate-50 text-slate-700 border-slate-200",
} as const;
export type Tone = keyof typeof TONE;

export function stateTone(state: string): Tone {
  if (["VERIFIED", "PAID", "LANDED"].includes(state)) return "green";
  if (state === "NEEDS_HUMAN") return "amber";
  if (["UNCONFIRMED", "RECOVERY"].includes(state)) return "red";
  return "neutral";
}
export function accountTone(status: string): Tone {
  if (status === "verified") return "green";
  if (status === "unverified" || status === "probing") return "amber";
  if (status === "disputed" || status === "rejected") return "red";
  return "neutral";
}

function Pill({
  tone,
  label,
  token,
  className,
}: {
  tone: Tone;
  label: string;
  token?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded h-6 px-2 text-[10px] font-medium",
        TONE[tone],
        className,
      )}
    >
      <span>{label}</span>
      {token && (
        <span className="font-mono text-[10px] opacity-70">{token}</span>
      )}
    </Badge>
  );
}

export function CaseStatusBadge({
  state,
  showToken = false,
  className,
}: {
  state: string;
  showToken?: boolean;
  className?: string;
}) {
  return (
    <Pill
      tone={stateTone(state)}
      label={stateLabel(state)}
      token={showToken ? state : undefined}
      className={className}
    />
  );
}
export function AccountStatusBadge({ status }: { status: string }) {
  return <Pill tone={accountTone(status)} label={accountStatusLabel(status)} />;
}
export function LandingBadge({ state }: { state: string }) {
  return (
    <Pill
      tone={
        state === "landed"
          ? "green"
          : state === "unconfirmed"
            ? "red"
            : "neutral"
      }
      label={LANDING_LABELS[state] ?? state}
    />
  );
}
export function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <Pill
      tone={
        status === "held" ? "amber" : status === "paid" ? "green" : "neutral"
      }
      label={INVOICE_STATUS_LABELS[status] ?? status}
    />
  );
}
export function ProbeStateBadge({ state }: { state: string }) {
  return (
    <Pill
      tone={
        state === "available"
          ? "green"
          : state === "returned"
            ? "red"
            : "neutral"
      }
      label={PROBE_STATE_LABELS[state] ?? state}
    />
  );
}
export function ChannelBadge({ channel }: { channel: string }) {
  return (
    <Pill
      tone={channel === "email" ? "red" : "neutral"}
      label={channelLabel(channel)}
    />
  );
}
export function AuthBadge({ dmarc }: { dmarc: boolean }) {
  return (
    <Pill
      tone={dmarc ? "green" : "red"}
      label={dmarc ? "DMARC pass" : "DMARC fail"}
    />
  );
}

export function TrustBadge({
  level,
  superseded,
}: {
  level: string;
  superseded?: boolean;
}) {
  const tone: Tone =
    level === "record" ? "green" : level === "discovered" ? "neutral" : "red";
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex rounded focus-visible:outline-2 focus-visible:outline-ring"
              tabIndex={0}
              aria-label={`${trustLabel(level)}: ${TRUST_TOOLTIPS[level] ?? level}`}
            />
          }
        >
          <Pill tone={tone} label={trustLabel(level)} />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          {TRUST_TOOLTIPS[level] ?? level}
        </TooltipContent>
      </Tooltip>
      {superseded && <Pill tone="neutral" label="Superseded" />}
    </span>
  );
}
