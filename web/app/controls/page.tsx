"use client";
import { useState } from "react";
import { ShieldCheck, Sparkles, Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { usePolicy, usePolicyActions, useOperatorAdmin, useOperators, useScreeningSummary, useScreeningPending, useScreeningActions } from "@/lib/hooks";
import Link from "next/link";
import { useOperator } from "@/lib/operator";
import { usd } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";

type Policy = NonNullable<ReturnType<typeof usePolicy>>;

function Toggle({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm">
      <input id={id} type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}

function Threshold({ id, label, help, value, onChange, unit, disabled, max }: { id: string; label: string; help: string; value: number | null; onChange: (v: number | null) => void; unit: "usd" | "score" | "hours"; disabled?: boolean; max?: number }) {
  const on = value !== null;
  const display = unit === "usd" ? (value === null ? "" : String(value / 100)) : value === null ? "" : String(value);
  return (
    <div className="rounded-md border px-3 py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <input id={`${id}-on`} type="checkbox" className="mt-0.5" checked={on} disabled={disabled} aria-label={`Enable ${label}`} onChange={(e) => onChange(e.target.checked ? (unit === "usd" ? 2_500_000 : unit === "score" ? 45 : 24) : null)} />
        <div className="flex-1">
          <Label htmlFor={id} className="font-medium text-slate-900">
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">{help}</p>
          {on && (
            <div className="mt-2 flex items-center gap-2">
              {unit === "usd" && <span className="text-xs text-muted-foreground">$</span>}
              <Input
                id={id}
                type="number"
                min={0}
                max={max}
                step={unit === "usd" ? 100 : 1}
                className="h-8 w-40 font-mono text-xs"
                value={display}
                disabled={disabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onChange(unit === "usd" ? Math.round(n * 100) : Math.round(n));
                }}
              />
              <span className="text-xs text-muted-foreground">{unit === "usd" ? "and above" : unit === "score" ? "/100 and above" : "hours"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ControlsPage() {
  const policy = usePolicy();
  const { set, applyRecommended } = usePolicyActions();
  const { operator, isAdmin } = useOperator();
  const operators = useOperators();
  const admin = useOperatorAdmin();
  const screening = useScreeningSummary();
  const pendingHits = useScreeningPending();
  const { screenAll } = useScreeningActions();
  const [edited, setEdited] = useState<Policy | null>(null);
  // The draft is the saved policy until the admin edits a field.
  const draft: Policy | null = edited ?? policy ?? null;
  const setDraft = (p: Policy | null) => setEdited(p);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"clerk" | "approver" | "admin">("clerk");

  const dirty = policy && draft && JSON.stringify(policy) !== JSON.stringify(draft);

  async function save() {
    if (!operator || !draft) return;
    setBusy(true);
    setMsg(null);
    try {
      await set({ operatorId: operator._id, patch: draft });
      setEdited(null);
      setMsg("Policy saved. Every change is in the audit log.");
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Controls"
        description="Company policy enforced inside the payment boundary, after the structural guard. Everything here is off by default; the verification engine itself cannot be weakened from this page."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!isAdmin || busy}
              onClick={async () => {
                if (!operator) return;
                setBusy(true);
                try {
                  await applyRecommended({ operatorId: operator._id });
                  setEdited(null);
                  setMsg("Recommended controls applied.");
                } catch (e) {
                  setMsg(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Sparkles size={14} /> Apply recommended
            </Button>
            <Button size="sm" disabled={!isAdmin || !dirty || busy} onClick={save}>
              Save policy
            </Button>
          </>
        }
      />
      {!isAdmin && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You are acting as {operator?.name ?? "nobody"} ({operator ? ROLE_LABEL[operator.role] : "no role"}). Only an administrator can change policy or manage operators.
        </p>
      )}
      {msg && (
        <p className="text-sm" role="status">
          {msg}
        </p>
      )}
      {!draft ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Release thresholds" description="Who must sign off before money moves.">
            <div className="space-y-2">
              <Threshold id="dual" unit="usd" label="Dual approval" help="Payments at or above this amount need a second approver who is not the requester (maker-checker)." value={draft.dualApprovalAboveCents} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, dualApprovalAboveCents: v })} />
              <Threshold id="risk" unit="score" max={100} label="Risk review" help="If the destination's case scored at or above this on the risk assessment, an approver must review before the first payment." value={draft.riskReviewAbove} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, riskReviewAbove: v })} />
              <Threshold id="monitoring" unit="score" max={100} label="Monitoring review" help="If transaction monitoring scores a payment at or above this against the vendor's own history (velocity, amount vs baseline, structuring, dormant spike), an approver must review it." value={draft.monitoringReviewAbove} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, monitoringReviewAbove: v })} />
              <Threshold id="velocity" unit="usd" label="Daily vendor limit" help="Maximum total sent to one vendor in any rolling 24 hours." value={draft.maxPerVendorPerDayCents} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, maxPerVendorPerDayCents: v })} />
            </div>
          </Section>
          <Section title="Timing and rails" description="Controls that buy recovery time if a verification was wrong.">
            <div className="space-y-2">
              <Threshold id="cooling" unit="hours" max={720} label="Cooling-off after verification" help="Hours between verification and the first payment to a new account. Gives the vendor of record time to notice an unexpected call or deposit." value={draft.coolingOffHours === 0 ? null : draft.coolingOffHours} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, coolingOffHours: v ?? 0 })} />
              <Toggle id="wire" label="First payment by ACH only" help="The first payment to a never-paid account cannot go by wire. ACH credits can be recalled; wires are final." checked={draft.blockWireForFirstPayment} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, blockWireForFirstPayment: v })} />
              <Toggle id="screening" label="Block on sanctions-screening match" help="Refuse payments to a vendor with an unresolved potential or confirmed watchlist match." checked={draft.blockOnScreeningHit} disabled={!isAdmin} onChange={(v) => setDraft({ ...draft, blockOnScreeningHit: v })} />
            </div>
          </Section>
          <Section title="How this is enforced" description="Policy is a layer, not a replacement.">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>
                The structural guard runs first: destination exists, belongs to the vendor, is <span className="font-mono text-xs">verified</span>, current version. Nothing on this page can relax it.
              </li>
              <li>Then policy runs with the same transaction: screening, rail rule, cooling-off, velocity, approvals. The first failing control is the refusal reason.</li>
              <li>
                Refusals are returned, not thrown, so each one is a <span className="font-mono text-xs">payment_refused</span> event in the <Link href="/audit" className="underline underline-offset-2">audit log</Link> with the policy detail.
              </li>
              <li>An approval binds one invoice to one destination and is consumed by exactly one payment.</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Current policy: dual approval {policy?.dualApprovalAboveCents === null ? "off" : `≥ ${usd(policy?.dualApprovalAboveCents)}`} · risk review {policy?.riskReviewAbove === null ? "off" : `≥ ${policy?.riskReviewAbove}`} · monitoring review {policy?.monitoringReviewAbove === null || policy?.monitoringReviewAbove === undefined ? "off" : `≥ ${policy?.monitoringReviewAbove}`} · cooling-off {policy?.coolingOffHours ? `${policy.coolingOffHours}h` : "off"} · daily limit {policy?.maxPerVendorPerDayCents === null ? "off" : usd(policy?.maxPerVendorPerDayCents)} · ACH-first {policy?.blockWireForFirstPayment ? "on" : "off"} · screening block {policy?.blockOnScreeningHit ? "on" : "off"}
            </p>
          </Section>
          <Section
            title={<span className="flex items-center gap-2"><Radar size={14} /> Sanctions screening</span>}
            description={screening ? `List ${screening.listVersion} (${screening.listSize} entries, synthetic demo list; production loads OFAC SDN + consolidated). ${screening.screenedVendors} screened, ${screening.unscreened} not yet.` : "Loading…"}
            actions={
              <Button
                size="sm"
                variant="outline"
                disabled={!operator}
                onClick={async () => {
                  if (!operator) return;
                  try {
                    const r = await screenAll({});
                    setMsg(`Screened ${r.screened} vendors: ${r.potentialMatches} possible match${r.potentialMatches === 1 ? "" : "es"}.`);
                  } catch (e) {
                    setMsg(errorMessage(e));
                  }
                }}
              >
                Screen all vendors
              </Button>
            }
          >
            {screening && (
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Possible matches</dt><dd className={`font-mono tabular-nums ${screening.potentialMatches ? "text-amber-800" : ""}`}>{screening.potentialMatches}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Confirmed</dt><dd className={`font-mono tabular-nums ${screening.confirmed ? "text-red-800" : ""}`}>{screening.confirmed}</dd></div>
                <div><dt className="text-xs text-muted-foreground">False positives</dt><dd className="font-mono tabular-nums">{screening.falsePositives}</dd></div>
              </dl>
            )}
            {pendingHits && pendingHits.length > 0 && (
              <ul className="mt-3 divide-y text-xs">
                {pendingHits.map((h) => (
                  <li key={h._id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <Link href={`/vendors/${h.vendorId}`} className="font-medium text-slate-900 underline underline-offset-2">{h.vendorName}</Link>
                      <span className="text-muted-foreground"> vs {h.matches[0]?.entry} · {h.matches[0]?.program}</span>
                    </span>
                    <span className="font-mono tabular-nums">{Math.round((h.matches[0]?.score ?? 0) * 100)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Decisions (false positive / confirmed) are made on the vendor page by an approver. Turn on “Block on sanctions-screening match” above to make an open hit refuse payments.</p>
          </Section>
          <Section title="Operators and roles" description="Server-enforced roles. Adding an operator with their email is the invitation: they create their password at /signin with that email.">
            <ul className="divide-y text-sm">
              {(operators ?? []).map((o) => (
                <li key={o._id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#edf1ee] text-[10px] font-semibold text-[#557061]">{o.initials}</span>
                    <span>
                      <span className="block">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {ROLE_LABEL[o.role]}
                        {o.email ? ` · ${o.email}` : ""}
                      </span>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!isAdmin || o._id === operator?._id}
                    onClick={async () => {
                      if (!operator) return;
                      try {
                        await admin.deactivate({ operatorId: operator._id, target: o._id });
                      } catch (e) {
                        setMsg(errorMessage(e));
                      }
                    }}
                  >
                    Deactivate
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!operator) return;
                try {
                  await admin.create({ operatorId: operator._id, name: newName, role: newRole, email: newEmail });
                  setNewName("");
                  setNewEmail("");
                  setMsg(`Added ${newName}. They can now create their password at /signin with ${newEmail.trim().toLowerCase()}.`);
                } catch (err) {
                  setMsg(errorMessage(err));
                }
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="op-name" className="text-xs">
                  Name
                </Label>
                <Input id="op-name" className="h-8 w-44 text-xs" value={newName} disabled={!isAdmin} onChange={(e) => setNewName(e.target.value)} placeholder="Jordan Lee" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="op-email" className="text-xs">
                  Email (sign-in)
                </Label>
                <Input id="op-email" type="email" className="h-8 w-56 text-xs" value={newEmail} disabled={!isAdmin} onChange={(e) => setNewEmail(e.target.value)} placeholder="jordan@company.example" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="op-role" className="text-xs">
                  Role
                </Label>
                <select id="op-role" className="h-8 rounded-md border bg-white px-2 text-xs" value={newRole} disabled={!isAdmin} onChange={(e) => setNewRole(e.target.value as typeof newRole)}>
                  <option value="clerk">AP clerk</option>
                  <option value="approver">Approver</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={!isAdmin || newName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(newEmail.trim())}>
                <ShieldCheck size={14} /> Add operator
              </Button>
            </form>
          </Section>
        </div>
      )}
    </div>
  );
}
