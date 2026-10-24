"use client";
import { ProbeStateBadge, AccountStatusBadge, ChannelBadge, TrustBadge, LandingBadge } from "./badges";
import { Section, KV } from "./primitives";
import { absTime, usd } from "@/lib/format";
import { rejectLabel } from "@/lib/labels";

type Probe = { state: string; submittedAt: number; settledAt?: number; availableAt?: number; railRef?: string } | null | undefined;

export function ProbeCard({ probe }: { probe: Probe }) {
  return (
    <Section title="Probe deposit" description="Randomized sub-dollar credit, memo ACCTVERIFY. Amount withheld.">
      {probe === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : probe === null ? (
        <p className="text-sm text-muted-foreground">No probe. The case was escalated before a probe was sent.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <KV k="State" v={<ProbeStateBadge state={probe.state} />} />
          <KV k="Submitted" v={absTime(probe.submittedAt)} mono />
          <KV k="Settled" v={absTime(probe.settledAt)} mono />
          <KV k="Available" v={absTime(probe.availableAt)} mono />
          <KV k="Rail ref" v={<span className="break-all">{probe.railRef ?? "pending"}</span>} mono />
          <KV k="Amount" v={<span className="text-muted-foreground">withheld — only the server compares it</span>} />
        </dl>
      )}
    </Section>
  );
}

type Account = { _id: string; routing: string; accountLast4: string; status: string; version: number; createdVia?: string; firstPaidAt?: number } | null;

function AccountRow({ label, a }: { label: string; a: Account }) {
  if (!a) return null;
  return (
    <tr className="border-t first:border-t-0">
      <td className="py-1.5 pr-2 text-xs text-muted-foreground">{label}</td>
      <td className="py-1.5 pr-2 font-mono text-xs tabular-nums">{a.routing} · …{a.accountLast4}</td>
      <td className="py-1.5 pr-2 font-mono text-xs">v{a.version}</td>
      <td className="py-1.5"><AccountStatusBadge status={a.status} /></td>
    </tr>
  );
}

export function AccountTable({ newAccount, oldAccount, amountAtStakeCents }: { newAccount: Account; oldAccount: Account; amountAtStakeCents?: number }) {
  return (
    <Section title="Destination account" description="Versioned. Only a verified version can be paid.">
      <table className="w-full text-sm">
        <tbody>
          <AccountRow label="Requested" a={newAccount} />
          <AccountRow label="Replaces" a={oldAccount} />
        </tbody>
      </table>
      {amountAtStakeCents !== undefined && (
        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          Open invoices pointed here: <span className="font-mono tabular-nums text-slate-900">{usd(amountAtStakeCents)}</span>
        </div>
      )}
    </Section>
  );
}

export type Confirmation = {
  _id: string; channel: string; accepted: boolean; rejectReason: string | null; receivedAt: number; usedAt: number | null; mode: string;
  hasStatedAmount: boolean; statedAmountCents?: number;
  contact: { kind: string; value: string; trustLevel: string; supersededAt: number | null } | null;
};

export function ConfirmationList({ confirmations }: { confirmations: Confirmation[] | undefined }) {
  return (
    <Section title="Confirmations" description="Every stated amount that reached us. Only a bound, accepted statement from the contact of record can verify.">
      {!confirmations ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : confirmations.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="divide-y">
          {confirmations.map((k) => (
            <li key={k._id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <ChannelBadge channel={k.channel} />
                {k.mode === "landing" && <span className="rounded border px-1.5 text-[11px]">landing</span>}
                <span className={k.accepted ? "rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-800" : "rounded border border-red-200 bg-red-50 px-1.5 text-[11px] text-red-800"}>
                  {k.accepted ? "accepted by channel" : "not accepted"}
                </span>
                {k.usedAt && <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[11px] text-emerald-800">used to verify</span>}
                {k.contact && <TrustBadge level={k.contact.trustLevel} superseded={!!k.contact.supersededAt} />}
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{absTime(k.receivedAt)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-700">
                {k.hasStatedAmount ? (k.mode === "landing" && k.statedAmountCents !== undefined ? `Stated ${usd(k.statedAmountCents)}` : "Stated an amount (withheld)") : "Stated: nothing arrived"}
                {k.rejectReason && <span className="ml-2 text-red-700">{rejectLabel(k.rejectReason)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

type Payment = { amountCents: number; rail: string; railRef?: string; sentAt: number; landingState: string; landingDeadlineAt: number; initiatedBy: string } | null | undefined;

export function PaymentCard({ payment, now }: { payment: Payment; now: number }) {
  if (!payment) return null;
  const left = payment.landingDeadlineAt - now;
  return (
    <Section title="Payment">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <KV k="Amount" v={<span className="font-mono tabular-nums">{usd(payment.amountCents)} · {payment.rail.toUpperCase()}</span>} />
        <KV k="Landing" v={<LandingBadge state={payment.landingState} />} />
        <KV k="Sent" v={`${absTime(payment.sentAt)} by ${payment.initiatedBy}`} mono />
        <KV k="Deadline" v={`${absTime(payment.landingDeadlineAt)}${payment.landingState === "pending" && now ? (left > 0 ? ` (${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m left)` : " (passed)") : ""}`} mono />
        <KV k="Rail ref" v={<span className="break-all">{payment.railRef ?? "pending"}</span>} mono />
      </dl>
    </Section>
  );
}
