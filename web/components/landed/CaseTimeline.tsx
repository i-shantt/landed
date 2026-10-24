"use client";
import { Fragment } from "react";
import { Bot, User, Landmark, Phone, Cog } from "lucide-react";
import { eventLabel, actorLabel, refusalLabel, humanReasonLabel, rejectLabel, payloadLabel, channelLabel, triggerLabel, stateLabel, trustLabel, accountStatusLabel } from "@/lib/labels";
import { absTime, relTime, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TimelineEvent = { _id: string; at: number; actor: string; type: string; payload: unknown };

const ICONS: Record<string, typeof Bot> = { agent: Bot, human: User, rail: Landmark, vendor: Phone, system: Cog };
const TONE: Record<string, string> = {
  account_verified: "bg-emerald-600", case_landed: "bg-emerald-600", payment_landed: "bg-emerald-600", payment_sent: "bg-emerald-600",
  escalated: "bg-amber-500", sla_expired: "bg-amber-500", human_review_requested: "bg-amber-500",
  payment_refused: "bg-red-600", release_refused: "bg-red-500", fraud_reported: "bg-red-600", recovery_started: "bg-red-600", landing_unconfirmed: "bg-red-600", account_disputed: "bg-red-600", change_rejected: "bg-red-500", agent_leaked_amount: "bg-red-500",
};

const SKIP = new Set(["from", "to", "note", "probeId", "confirmationId", "messageId", "paymentId", "accountId", "contactId", "vendorId", "invoiceId", "caseId"]);

function chipText(type: string, k: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (k === "reason" && typeof v === "string") {
    if (type === "release_refused" || type === "payment_refused") return `${refusalLabel(v)}`;
    if (type.startsWith("escalated") || type === "sla_expired") return humanReasonLabel(v);
    return v;
  }
  if (k === "rejectReason" && typeof v === "string") return rejectLabel(v);
  if (k === "channel" && typeof v === "string") return `${payloadLabel(k)}: ${channelLabel(v)}`;
  if (k === "triggerType" && typeof v === "string") return triggerLabel(v);
  if (k === "accepted") return v ? "accepted by channel" : "not accepted";
  if (k === "outcome" && typeof v === "string") return ({ stated: "vendor stated an amount", nothing_arrived: "vendor saw nothing", no_answer: "no answer / voicemail" } as Record<string, string>)[v] ?? v;
  if (k === "result" && typeof v === "string") return `provider result: ${({ no_coverage: "no coverage", match: "match", mismatch: "mismatch" } as Record<string, string>)[v] ?? v}`;
  if (k === "next" && typeof v === "string") return `next: ${v === "probe" ? "probe deposit" : v}`;
  if (k === "mode" && typeof v === "string") return `${v === "landing" ? "landing check" : "probe verification"}`;
  if (k === "contactTrust" && typeof v === "string") return `contact: ${trustLabel(v).toLowerCase()}`;
  if (k === "contactKind" && typeof v === "string") return `via ${(v === "phone" ? "phone" : v === "portal" ? "portal login" : v)}`;
  if (k === "createdVia" && typeof v === "string") return `created via ${v.replace(/_/g, " ")}`;
  if (k === "status" && typeof v === "string") return `status: ${accountStatusLabel(v).toLowerCase()}`;
  if (k === "amountCents" && typeof v === "number") return `amount ${usd(v)}`;
  if ((k === "expectedCents" || k === "statedCents") && typeof v === "number") return `${payloadLabel(k)} ${usd(v)}`;
  if (k.endsWith("At") && typeof v === "number") return `${payloadLabel(k)} ${absTime(v)}`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("last4" in o) return `${payloadLabel(k)} …${o.last4}${o.version ? ` v${o.version}` : ""}${typeof o.status === "string" ? ` (${o.status})` : ""}`;
    if (Array.isArray(v)) return `${payloadLabel(k)}: ${v.map(String).join(", ").slice(0, 80)}`;
    return null;
  }
  if (typeof v === "boolean") return `${payloadLabel(k)}: ${v ? "yes" : "no"}`;
  return `${payloadLabel(k)}: ${String(v)}`;
}

/** Compact plain-English chips for an event payload (shared by the timeline and the audit view). */
export function payloadChips(type: string, payload: unknown): { chips: string[]; transition: string | null; note: string | null } {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const chips = Object.entries(p).filter(([k]) => !SKIP.has(k)).map(([k, v]) => chipText(type, k, v)).filter((x): x is string => !!x);
  const transition = typeof p.from === "string" && typeof p.to === "string" ? `${stateLabel(p.from)} → ${stateLabel(p.to)}` : null;
  return { chips, transition, note: typeof p.note === "string" ? p.note : null };
}

export function EventRow({ e, now }: { e: TimelineEvent; now: number }) {
  const Icon = ICONS[e.actor] ?? Cog;
  const p = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
  const chips = Object.entries(p).filter(([k]) => !SKIP.has(k)).map(([k, v]) => chipText(e.type, k, v)).filter((x): x is string => !!x);
  const transition = typeof p.from === "string" && typeof p.to === "string" ? `${stateLabel(p.from)} → ${stateLabel(p.to)}` : null;
  return (
    <li className="relative flex gap-3 py-2">
      <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-card", TONE[e.type] ?? "bg-slate-400")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-slate-900">{eventLabel(e.type)}</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon className="size-3" aria-hidden />
            {actorLabel(e.actor)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground" title={absTime(e.at)}>
            {absTime(e.at)}{now ? ` · ${relTime(e.at, now)}` : ""}
          </span>
        </div>
        {(transition || chips.length > 0 || typeof p.note === "string") && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {transition && <span className="rounded border bg-muted px-1.5 font-mono text-[11px]">{transition}</span>}
            {chips.map((c, i) => (
              <span key={i} className="rounded border bg-card px-1.5 text-[11px] text-slate-700">{c}</span>
            ))}
            {typeof p.note === "string" && <span className="text-[11px] italic text-muted-foreground">{p.note}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function dayKey(t: number) {
  return new Date(t).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });
}

/** Vertical timeline grouped by day. Pass `filter` to show only matching labels/types. */
export function CaseTimeline({ events, now, filter }: { events: TimelineEvent[]; now: number; filter?: string }) {
  const q = (filter ?? "").trim().toLowerCase();
  const shown = q ? events.filter((e) => eventLabel(e.type).toLowerCase().includes(q) || e.type.includes(q) || JSON.stringify(e.payload ?? "").toLowerCase().includes(q)) : events;
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">{events.length === 0 ? "No events yet." : "No events match the filter."}</p>;
  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of shown) {
    const d = dayKey(e.at);
    const g = groups[groups.length - 1];
    if (g && g.day === d) g.items.push(e);
    else groups.push({ day: d, items: [e] });
  }
  return (
    <ol className="relative ml-1 border-l border-slate-200 pl-3">
      {groups.map((g) => (
        <Fragment key={g.day}>
          <li className="-ml-3 py-1 pl-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.day}</li>
          {g.items.map((e) => (
            <EventRow key={e._id} e={e} now={now} />
          ))}
        </Fragment>
      ))}
    </ol>
  );
}
