// Pure guard functions. No ctx, no I/O. These are the payment boundary (I1) and
// the release gate (I3). Order of checks in canRelease is exactly the order in
// the brief so tests can assert specific refusal reasons.
import type { Doc } from "./_generated/dataModel";

export type InvoiceDoc = Doc<"invoices">;
export type BankAccountDoc = Doc<"bankAccounts">;
export type CaseDoc = Doc<"cases">;
export type ProbeDoc = Doc<"probes">;
export type ConfirmationDoc = Doc<"confirmations">;
export type ContactDoc = Doc<"contacts">;

export type PayRefusal =
  | "destination_missing"
  | "destination_vendor_mismatch"
  | "destination_not_verified"
  | "destination_disputed"
  | "destination_superseded"
  | "destination_stale_version"
  | "invoice_missing"
  | "invoice_not_open";

export type PayDecision = { ok: true } | { ok: false; reason: PayRefusal };

export function canPay(args: {
  invoice: InvoiceDoc | null;
  destination: BankAccountDoc | null;
  currentVersionForIdentity: number | null;
}): PayDecision {
  const { invoice, destination, currentVersionForIdentity } = args;
  if (!invoice) return { ok: false, reason: "invoice_missing" };
  // "held" invoices are open invoices whose destination is pending verification; the destination checks
  // below produce the precise reason. Only "paid" is not payable here.
  if (invoice.status !== "open" && invoice.status !== "held") return { ok: false, reason: "invoice_not_open" };
  if (!destination) return { ok: false, reason: "destination_missing" };
  if (destination.vendorId !== invoice.vendorId)
    return { ok: false, reason: "destination_vendor_mismatch" };
  if (destination.status === "disputed") return { ok: false, reason: "destination_disputed" };
  if (destination.status === "superseded") return { ok: false, reason: "destination_superseded" };
  if (destination.status !== "verified") return { ok: false, reason: "destination_not_verified" };
  if (currentVersionForIdentity === null || destination.version !== currentVersionForIdentity)
    return { ok: false, reason: "destination_stale_version" };
  return { ok: true };
}

export type ReleaseRefusal =
  | "no_confirmation"
  | "confirmation_not_accepted"
  | "confirmation_used"
  | "confirmation_expired"
  | "case_mismatch"
  | "vendor_mismatch"
  | "account_hash_mismatch"
  | "account_version_mismatch"
  | "probe_mismatch"
  | "probe_not_available"
  | "amount_mismatch"
  | "contact_not_record"
  | "contact_superseded"
  | "contact_missing"
  | "received_before_available";

export type ReleaseDecision = { ok: true } | { ok: false; reason: ReleaseRefusal };

/**
 * I3. Verification is bound. Check order (matches the brief):
 *  caseId, vendorId, accountHash, accountVersion, probeId, probe available,
 *  amount, contact record now, contact not superseded, accepted, unused,
 *  receivedAt after availableAt and before expiresAt.
 * We check existence/accepted/used/expired first only where a null would make
 * the rest meaningless; the binding checks then follow the brief's order.
 */
export function canRelease(args: {
  caseDoc: CaseDoc;
  account: BankAccountDoc;
  probe: ProbeDoc | null;
  confirmation: ConfirmationDoc | null;
  contact: ContactDoc | null;
  now: number;
}): ReleaseDecision {
  const { caseDoc, account, probe, confirmation, contact, now } = args;
  if (!confirmation) return { ok: false, reason: "no_confirmation" };
  if (confirmation.caseId !== caseDoc._id) return { ok: false, reason: "case_mismatch" };
  if (confirmation.vendorId !== caseDoc.vendorId || account.vendorId !== caseDoc.vendorId)
    return { ok: false, reason: "vendor_mismatch" };
  if (confirmation.accountHash !== account.accountHash)
    return { ok: false, reason: "account_hash_mismatch" };
  if (confirmation.accountVersion !== account.version)
    return { ok: false, reason: "account_version_mismatch" };
  if (!probe || !caseDoc.probeId || confirmation.probeId !== caseDoc.probeId || probe._id !== caseDoc.probeId)
    return { ok: false, reason: "probe_mismatch" };
  if (probe.state !== "available" || probe.availableAt === undefined)
    return { ok: false, reason: "probe_not_available" };
  if (
    confirmation.statedAmountCents === undefined ||
    confirmation.statedAmountCents === null ||
    confirmation.statedAmountCents !== probe.amountCents
  )
    return { ok: false, reason: "amount_mismatch" };
  if (!contact) return { ok: false, reason: "contact_missing" };
  if (contact.trustLevel !== "record") return { ok: false, reason: "contact_not_record" };
  if (contact.supersededAt !== undefined && contact.supersededAt !== null)
    return { ok: false, reason: "contact_superseded" };
  if (!confirmation.accepted) return { ok: false, reason: "confirmation_not_accepted" };
  if (confirmation.usedAt !== undefined && confirmation.usedAt !== null)
    return { ok: false, reason: "confirmation_used" };
  if (confirmation.receivedAt <= probe.availableAt)
    return { ok: false, reason: "received_before_available" };
  if (confirmation.receivedAt >= confirmation.expiresAt || now >= confirmation.expiresAt)
    return { ok: false, reason: "confirmation_expired" };
  return { ok: true };
}

/** Allowed case state transitions (section 6.4). */
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  HELD: ["PROBE_SENT", "NEEDS_HUMAN"],
  PROBE_SENT: ["AWAITING_CONFIRMATION", "NEEDS_HUMAN"],
  AWAITING_CONFIRMATION: ["VERIFIED", "NEEDS_HUMAN"],
  NEEDS_HUMAN: ["VERIFIED", "RECOVERY", "CLOSED"],
  VERIFIED: ["PAID"],
  PAID: ["LANDED", "UNCONFIRMED"],
  UNCONFIRMED: ["RECOVERY"],
  RECOVERY: ["CLOSED"],
  LANDED: ["CLOSED"],
  CLOSED: [],
};

export function isAllowedTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
