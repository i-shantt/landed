"use client";
import { useState } from "react";
import { Radar } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/landed/primitives";
import { ReasonDialog, errorMessage } from "@/components/landed/ReasonDialog";
import { useScreeningForVendor, useScreeningActions } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { absTime } from "@/lib/format";

const TONE: Record<string, string> = {
  clear: "border-emerald-200 bg-emerald-50 text-emerald-900",
  potential_match: "border-amber-200 bg-amber-50 text-amber-900",
  confirmed_match: "border-red-200 bg-red-50 text-red-900",
  false_positive: "border-slate-200 bg-slate-50 text-slate-700",
};
const LABEL: Record<string, string> = { clear: "Clear", potential_match: "Possible match", confirmed_match: "Confirmed match", false_positive: "Reviewed: false positive" };

export function ScreeningPanel({ vendorId }: { vendorId: Id<"vendors"> }) {
  const data = useScreeningForVendor(vendorId);
  const { screenVendor, review } = useScreeningActions();
  const { operator, canApprove } = useOperator();
  const [dismissing, setDismissing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const latest = data?.latest ?? null;

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Radar size={14} /> Sanctions screening
          {latest && <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE[latest.status]}`}>{LABEL[latest.status]}</span>}
        </span>
      }
      description="Name matched against a watchlist at onboarding and on demand (Jaro-Winkler + token sort). Demo list is synthetic; production loads OFAC SDN and consolidated lists."
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={!operator}
          onClick={async () => {
            try {
              const r = await screenVendor({ vendorId });
              setMsg(r.inserted ? `Screened: ${LABEL[r.status]}.` : "No change since the last screening.");
            } catch (e) {
              setMsg(errorMessage(e));
            }
          }}
        >
          Screen now
        </Button>
      }
    >
      {data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !latest ? (
        <p className="text-sm text-muted-foreground">Never screened. Vendors created before screening existed are screened on demand or by “Screen all vendors” on the Controls page.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Last screened {absTime(latest.screenedAt)} against list <span className="font-mono">{latest.listVersion}</span>
            {latest.reviewedByName ? ` · reviewed by ${latest.reviewedByName}` : ""}
            {latest.note ? ` · “${latest.note}”` : ""}
          </p>
          {latest.matches.length === 0 ? (
            <p className="text-xs text-emerald-800">No entry scored above the reporting threshold.</p>
          ) : (
            <ul className="divide-y text-xs">
              {latest.matches.slice(0, 5).map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1">
                  <span>
                    <span className="font-medium text-slate-900">{m.entry}</span> <span className="text-muted-foreground">· {m.program}</span>
                  </span>
                  <span className="font-mono tabular-nums">
                    {(m.score * 100).toFixed(0)} <span className="text-muted-foreground">{m.method.replace("_", " ")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {latest.status === "potential_match" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={!canApprove} onClick={() => setDismissing(true)}>
                False positive
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!canApprove}
                onClick={async () => {
                  if (!operator) return;
                  try {
                    await review({ screeningId: latest._id, operatorId: operator._id, decision: "confirmed_match" });
                  } catch (e) {
                    setMsg(errorMessage(e));
                  }
                }}
              >
                Confirm match
              </Button>
              {!canApprove && <span className="text-xs text-muted-foreground">An approver or administrator decides.</span>}
            </div>
          )}
          {msg && (
            <p className="text-xs" role="status">
              {msg}
            </p>
          )}
        </div>
      )}
      <ReasonDialog
        open={dismissing}
        onOpenChange={setDismissing}
        title="Dismiss as a false positive?"
        description="Explain why this vendor is not the listed party (different jurisdiction, entity type, address…). Recorded in the audit log."
        confirmLabel="Dismiss"
        onConfirm={async (note) => {
          if (!operator || !latest) return;
          await review({ screeningId: latest._id, operatorId: operator._id, decision: "false_positive", note });
        }}
      />
    </Section>
  );
}
