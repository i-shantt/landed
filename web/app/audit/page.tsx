"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { PageHeader, Section, Loading, EmptyState } from "@/components/landed/primitives";
import { payloadChips } from "@/components/landed/CaseTimeline";
import { useAuditChain, useAuditEvents, useVendors } from "@/lib/hooks";
import { absTime, shortId, pacificLocalToEpoch } from "@/lib/format";
import { toCsv, downloadText } from "@/lib/csv";
import { actorLabel, eventLabel } from "@/lib/labels";
import { ACTORS } from "@/lib/enums";
import { chainOver } from "@/lib/hashchain";
import type { Id } from "@/convex/_generated/dataModel";

type Row = { _id: string; at: number; actor: string; type: string; caseId: string | null; vendorName: string | null; payload: unknown };

const TZ_HINT = "Interpreted as Pacific Time (America/Los_Angeles), the zone every timestamp in Landed is shown in, whatever your browser's zone.";

export default function AuditPage() {
  const vendors = useVendors();
  const [vendorId, setVendorId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const args = useMemo(() => ({
    vendorId: vendorId ? (vendorId as Id<"vendors">) : undefined,
    caseId: caseId.trim() ? (caseId.trim() as Id<"cases">) : undefined,
    actor: actor || undefined,
    type: type || undefined,
    from: from ? pacificLocalToEpoch(from) : undefined,
    to: to ? pacificLocalToEpoch(to) : undefined,
  }), [vendorId, caseId, actor, type, from, to]);
  const filtered = useAuditEvents(args);
  const all = useAuditEvents({ limit: 100000 });
  const chainAction = useAuditChain();
  const [localHead, setLocalHead] = useState<{ head: string; count: number } | null>(null);
  const [serverHead, setServerHead] = useState<{ head: string; count: number; computedAt: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);

  const types = useMemo(() => Array.from(new Set((all?.events ?? []).map((e) => e.type))).sort(), [all]);
  const rows: Row[] = filtered?.events ?? [];

  // Recompute the local chain whenever the full event set changes.
  useEffect(() => {
    let cancelled = false;
    if (!all) return;
    chainOver(all.events).then((c) => { if (!cancelled) setLocalHead(c); });
    return () => { cancelled = true; };
  }, [all]);

  async function check() {
    setChecking(true); setChainError(null);
    try { setServerHead(await chainAction({})); } catch (e) { setChainError(String((e as Error)?.message ?? e)); } finally { setChecking(false); }
  }

  const exportJson = () => downloadText(`landed-audit-${Date.now()}.json`, JSON.stringify(rows, null, 2), "application/json");
  const exportCsv = () => {
    const header = ["At (ISO 8601 UTC)", "At (PT)", "Actor", "Event type", "Case id", "Vendor", "Payload (JSON)"];
    const values = rows.map((r) => [new Date(r.at), absTime(r.at), r.actor, r.type, r.caseId ?? "", r.vendorName ?? "", r.payload as object]);
    downloadText(`landed-audit-${Date.now()}.csv`, toCsv(header, values));
  };

  const match = localHead && serverHead ? (localHead.head === serverHead.head && localHead.count === serverHead.count) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="Every event across all cases, read-only. Events are append-only (no update or delete function exists); the hash chain below is recomputed on read, so any edit to the stored order would change the head."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
            <Button variant="outline" size="sm" onClick={exportJson} disabled={rows.length === 0}>Export JSON</Button>
          </>
        }
      />
      <Section title="Chain check" description="SHA-256 over prev | time | actor | type | canonical payload, in stored order, from a fixed genesis. Computed here in the browser and on the server; both must agree.">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Browser head{localHead ? ` · ${localHead.count} events` : ""}</div>
            <div className="font-mono text-xs" title={localHead?.head ?? ""}>{localHead ? `${localHead.head.slice(0, 16)}…` : "computing…"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Server head{serverHead ? ` · ${serverHead.count} events · ${absTime(serverHead.computedAt)}` : ""}</div>
            <div className="font-mono text-xs" title={serverHead?.head ?? ""}>{serverHead ? `${serverHead.head.slice(0, 16)}…` : "not checked yet"}</div>
          </div>
          <Button size="sm" variant="outline" onClick={check} disabled={checking || !localHead}>{checking ? "Checking…" : "Check chain"}</Button>
          {match !== null && (
            <span className={match ? "rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900" : "rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-900"}>
              {match ? "match" : "mismatch"}
            </span>
          )}
          {chainError && <span className="text-xs text-red-800">{chainError}</span>}
        </div>
      </Section>
      <Section title="Filters">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="au-vendor">Vendor</Label>
            <NativeSelect id="au-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">All vendors</option>
              {(vendors ?? []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-case">Case id</Label>
            <Input id="au-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="jd7…" className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-actor">Actor</Label>
            <NativeSelect id="au-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">All actors</option>
              {ACTORS.map((a) => <option key={a} value={a}>{actorLabel(a)}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-type">Type</Label>
            <NativeSelect id="au-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{eventLabel(t)}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-from" title={TZ_HINT}>From (PT)</Label>
            <Input id="au-from" type="datetime-local" title={TZ_HINT} value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="au-to" title={TZ_HINT}>To (PT)</Label>
            <Input id="au-to" type="datetime-local" title={TZ_HINT} value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
          </div>
        </div>
      </Section>
      {filtered === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title="No events match" description="Loosen a filter, or open a case to generate activity." />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" role="status">{filtered.total} event{filtered.total === 1 ? "" : "s"}{filtered.total > rows.length ? ` (showing the latest ${rows.length})` : ""}</p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const { chips, transition, note } = payloadChips(r.type, r.payload);
                  return (
                    <TableRow key={r._id}>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">{absTime(r.at)}</TableCell>
                      <TableCell className="text-xs">{actorLabel(r.actor)}</TableCell>
                      <TableCell>
                        <span className="text-sm text-slate-900">{eventLabel(r.type)}</span>
                        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{r.type}</span>
                      </TableCell>
                      <TableCell className="text-xs">{r.vendorName ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px]">{r.caseId ? <Link className="underline" href={`/cases/${r.caseId}`}>{shortId(r.caseId)}</Link> : "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {transition && <span className="rounded border bg-muted px-1.5 font-mono text-[11px]">{transition}</span>}
                          {chips.map((c, i) => <span key={i} className="rounded border bg-card px-1.5 text-[11px] text-slate-700">{c}</span>)}
                          {note && <span className="text-[11px] italic text-muted-foreground">{note}</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
