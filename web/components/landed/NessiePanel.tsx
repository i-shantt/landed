"use client";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Section } from "./primitives";
import { errorMessage } from "./ReasonDialog";
import { useNessieTransfers, useSettings } from "@/lib/hooks";

type Item = { kind: string; id: string; record: unknown };

export function NessiePanel({ caseId }: { caseId: Id<"cases"> }) {
  const settings = useSettings();
  const load = useNessieTransfers();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ enabled: boolean; reason?: string; items: Item[]; caveat: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (settings?.rail !== "nessie") return null;
  return (
    <Section
      title="Nessie transfers"
      description="Capital One Nessie records behind this case's probe and payment."
      actions={<Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { setRes(await load({ caseId })); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } }}>{busy ? "Loading…" : "Load"}</Button>}
    >
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      {res && !res.enabled && <p className="text-sm text-muted-foreground">Not available: {res.reason}</p>}
      {res && res.enabled && (
        <div className="space-y-2">
          {res.items.length === 0 && <p className="text-sm text-muted-foreground">No Nessie rail refs on this case yet.</p>}
          {res.items.map((it) => {
            const r = (it.record ?? {}) as Record<string, unknown>;
            return (
              <div key={it.id} className="rounded border px-3 py-2 text-xs">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-medium capitalize">{it.kind}</span>
                  <span className="font-mono break-all">{it.id}</span>
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-muted-foreground">amount</dt><dd className="font-mono tabular-nums">{"amount" in r ? `${String(r.amount)} (integer cents)` : "—"}</dd>
                  <dt className="text-muted-foreground">status</dt><dd>{String(r.status ?? r.error ?? "—")}</dd>
                  <dt className="text-muted-foreground">description</dt><dd>{String(r.description ?? "—")}</dd>
                </dl>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{res.caveat}</p>
        </div>
      )}
    </Section>
  );
}
