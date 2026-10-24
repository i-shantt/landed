"use client";
import { eventLabel, ACTOR_LABELS, refusalLabel, humanReasonLabel } from "@/lib/labels";
import { absTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export type TimelineEvent = { _id: string; at: number; actor: string; type: string; payload: unknown };

function Payload({ type, payload }: { type: string; payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  const skip = new Set(["from", "to", "note"]);
  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k) || v === null || v === undefined) continue;
    if (k === "reason" && typeof v === "string") {
      parts.push(`reason: ${type === "release_refused" || type === "payment_refused" ? refusalLabel(v) : humanReasonLabel(v)}`);
      continue;
    }
    if (typeof v === "object") {
      const inner = v as Record<string, unknown>;
      if ("last4" in inner) parts.push(`${k}: …${inner.last4}${inner.version ? ` v${inner.version}` : ""}`);
      else parts.push(`${k}: ${JSON.stringify(v).slice(0, 80)}`);
      continue;
    }
    if (k.endsWith("At") && typeof v === "number") parts.push(`${k}: ${absTime(v)}`);
    else if (k === "amountCents" && typeof v === "number") parts.push(`amount: $${(v / 100).toFixed(2)}`);
    else parts.push(`${k}: ${String(v)}`);
  }
  const trans = p.from && p.to ? `${p.from} → ${p.to}` : null;
  return (
    <div className="text-xs text-muted-foreground space-x-2">
      {trans && <span className="font-mono">{trans}</span>}
      {parts.length > 0 && <span>{parts.join(" · ")}</span>}
      {typeof p.note === "string" && <span className="italic">{p.note}</span>}
    </div>
  );
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>;
  return (
    <ol className="relative border-l pl-4 space-y-3">
      {events.map((e) => (
        <li key={e._id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-zinc-400" />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium">{eventLabel(e.type)}</span>
            <Badge variant="outline" className="text-[10px]">
              {ACTOR_LABELS[e.actor] ?? e.actor}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{absTime(e.at)}</span>
          </div>
          <Payload type={e.type} payload={e.payload} />
        </li>
      ))}
    </ol>
  );
}
