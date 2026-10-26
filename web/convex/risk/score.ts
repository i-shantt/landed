// Deterministic, explainable risk scoring for a bank-change request. Pure: no ctx, no I/O.
// The score never releases anything (I5 still holds: the guard decides; risk only informs
// humans and the policy engine's "needs review" threshold).
//
// Every signal carries the evidence it was computed from so an auditor can reproduce it.

export type RiskSignalId =
  | "email_auth_failed"
  | "sender_domain_lookalike"
  | "reply_to_mismatch"
  | "contact_also_changed"
  | "urgency_language"
  | "off_hours_request"
  | "large_amount_at_stake"
  | "vendor_tenure_short"
  | "recent_prior_change"
  | "routing_checksum_invalid"
  | "routing_bank_changed"
  | "receipt_claim_by_email"
  | "validation_mismatch"
  | "account_reused_across_vendors"
  | "manual_edit_no_document"
  | "secrecy_language";

export type RiskSignal = {
  id: RiskSignalId;
  weight: number;
  title: string;
  evidence: string;
};

export type RiskTier = "low" | "elevated" | "high" | "critical";

export type RiskAssessment = {
  score: number; // 0..100
  tier: RiskTier;
  signals: RiskSignal[];
  recommendation: string;
  /** Signals that were evaluated and did not fire, for the "what we checked" list. */
  checked: RiskSignalId[];
};

export type RiskInput = {
  triggerType: string;
  message: {
    from: string;
    subject: string;
    body: string;
    sentAt: number;
    authResult: { spf: boolean; dkim: boolean; dmarc: boolean };
    replyTo?: string | null;
  } | null;
  senderMismatchReason?: string | null; // "lookalike_domain" | "name_match" | null
  contactAlsoChanged: boolean;
  amountAtStakeCents: number;
  vendorOnboardedAt: number;
  priorCasesLast90Days: number; // other cases for this vendor opened in the 90 days before this one
  newRouting: string;
  oldRouting: string | null;
  receiptClaimByEmail: boolean;
  validationProviderResult: string | null;
  accountUsedByOtherVendors: number; // distinct other vendors sharing this account hash
  caseOpenedAt: number;
  timezone: string; // company timezone for off-hours detection
};

const URGENCY = /\b(urgent(ly)?|immediate(ly)?|asap|right away|today|before (the )?(end of day|eod|close)|final notice|past due|overdue|last chance|time[- ]sensitive|without delay)\b/i;
const SECRECY = /\b(confidential|do not (call|phone|contact)|don't call|only (reply|respond) by email|keep this between|discreet(ly)?)\b/i;

/** ABA routing transit number checksum: weights 3,7,1 repeating; sum mod 10 must be 0. */
export function isValidAbaRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(routing[i]) * w[i];
  if (sum % 10 !== 0) return false;
  // First two digits identify the Federal Reserve routing symbol / thrift / ETF ranges.
  const prefix = Number(routing.slice(0, 2));
  return (prefix >= 0 && prefix <= 12) || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80;
}

export function localHourAndDay(t: number, timezone: string): { hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(new Date(t));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12") % 24;
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return { hour, weekday: weekday < 0 ? 1 : weekday };
  } catch {
    const d = new Date(t);
    return { hour: d.getUTCHours(), weekday: d.getUTCDay() };
  }
}

export function tierFor(score: number): RiskTier {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "elevated";
  return "low";
}

export const TIER_RECOMMENDATION: Record<RiskTier, string> = {
  low: "Standard path: probe deposit and read-back by the contact of record.",
  elevated: "Standard path; a reviewer should read the request before the first payment.",
  high: "Hold for human review alongside the probe. Do not use an exceptional release.",
  critical: "Treat as a probable attack: notify the vendor on the number of record and consider rejecting the change.",
};

const DAY = 86_400_000;

export function scoreRisk(input: RiskInput): RiskAssessment {
  const signals: RiskSignal[] = [];
  const checked: RiskSignalId[] = [];
  const fire = (s: RiskSignal) => signals.push(s);
  const check = (id: RiskSignalId) => checked.push(id);

  const m = input.message;

  check("email_auth_failed");
  if (m) {
    const failed = [!m.authResult.spf && "SPF", !m.authResult.dkim && "DKIM", !m.authResult.dmarc && "DMARC"].filter(Boolean) as string[];
    if (failed.length) fire({ id: "email_auth_failed", weight: failed.includes("DMARC") ? 25 : 15, title: "Email authentication failed", evidence: `${failed.join(", ")} failed on the request from ${m.from}` });
  }

  check("sender_domain_lookalike");
  if (input.senderMismatchReason === "lookalike_domain" || input.triggerType === "instruction_change_lookalike") {
    fire({ id: "sender_domain_lookalike", weight: 30, title: "Sender domain is a lookalike", evidence: m ? `${m.from} is not the vendor's domain of record` : "sender domain mismatch recorded at intake" });
  } else if (input.senderMismatchReason === "name_match") {
    fire({ id: "sender_domain_lookalike", weight: 20, title: "Sender is not the vendor's domain", evidence: m ? `${m.from} names the vendor but is an unknown domain` : "unknown sender named the vendor" });
  }

  check("reply_to_mismatch");
  if (m?.replyTo) {
    const fromDomain = m.from.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    const replyDomain = m.replyTo.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    if (fromDomain && replyDomain && fromDomain !== replyDomain) fire({ id: "reply_to_mismatch", weight: 15, title: "Reply-To points elsewhere", evidence: `From ${fromDomain}, replies go to ${replyDomain}` });
  }

  check("contact_also_changed");
  if (input.contactAlsoChanged) fire({ id: "contact_also_changed", weight: 20, title: "Phone number changed with the bank account", evidence: "the request supplies a new callback number; the number of record is ignored for verification" });

  check("urgency_language");
  check("secrecy_language");
  if (m) {
    const text = `${m.subject}\n${m.body}`;
    const u = text.match(URGENCY);
    if (u) fire({ id: "urgency_language", weight: 10, title: "Urgency language", evidence: `"${u[0]}"` });
    const s = text.match(SECRECY);
    if (s) fire({ id: "secrecy_language", weight: 15, title: "Discourages a phone check", evidence: `"${s[0]}"` });
  }

  check("off_hours_request");
  if (m) {
    const { hour, weekday } = localHourAndDay(m.sentAt, input.timezone);
    if (weekday === 0 || weekday === 6 || hour < 6 || hour >= 20) fire({ id: "off_hours_request", weight: 5, title: "Sent outside business hours", evidence: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]} ${String(hour).padStart(2, "0")}:00 ${input.timezone}` });
  }

  check("large_amount_at_stake");
  if (input.amountAtStakeCents >= 10_000_000) fire({ id: "large_amount_at_stake", weight: 20, title: "Very large amount at stake", evidence: `$${(input.amountAtStakeCents / 100).toLocaleString("en-US")} in open invoices would follow this account` });
  else if (input.amountAtStakeCents >= 2_500_000) fire({ id: "large_amount_at_stake", weight: 10, title: "Large amount at stake", evidence: `$${(input.amountAtStakeCents / 100).toLocaleString("en-US")} in open invoices would follow this account` });

  check("vendor_tenure_short");
  const tenureDays = Math.floor((input.caseOpenedAt - input.vendorOnboardedAt) / DAY);
  if (tenureDays < 90) fire({ id: "vendor_tenure_short", weight: 10, title: "New vendor", evidence: `onboarded ${tenureDays} days before this request` });

  check("recent_prior_change");
  if (input.priorCasesLast90Days > 0) fire({ id: "recent_prior_change", weight: 10, title: "Repeated bank changes", evidence: `${input.priorCasesLast90Days} other change request(s) in the previous 90 days` });

  check("routing_checksum_invalid");
  if (!isValidAbaRouting(input.newRouting)) fire({ id: "routing_checksum_invalid", weight: 25, title: "Routing number fails the ABA checksum", evidence: `${input.newRouting} is not a valid routing transit number` });

  check("routing_bank_changed");
  if (input.oldRouting && input.oldRouting !== input.newRouting) fire({ id: "routing_bank_changed", weight: 5, title: "Different bank", evidence: `routing ${input.oldRouting} to ${input.newRouting}` });

  check("receipt_claim_by_email");
  if (input.receiptClaimByEmail) fire({ id: "receipt_claim_by_email", weight: 15, title: "Someone emailed a deposit amount", evidence: "an email tried to confirm the probe; only the contact of record on a trusted channel can" });

  check("validation_mismatch");
  if (input.validationProviderResult === "mismatch") fire({ id: "validation_mismatch", weight: 30, title: "Account-validation provider disagrees", evidence: "the account is on file under a different owner" });

  check("account_reused_across_vendors");
  if (input.accountUsedByOtherVendors > 0) fire({ id: "account_reused_across_vendors", weight: 40, title: "Account already used by another vendor", evidence: `${input.accountUsedByOtherVendors} other vendor(s) have requested this exact account (mule-account pattern)` });

  check("manual_edit_no_document");
  if (input.triggerType === "manual_edit") fire({ id: "manual_edit_no_document", weight: 5, title: "Typed by a clerk, no source document", evidence: "no email or letter is attached to this change" });

  signals.sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  const tier = tierFor(score);
  return { score, tier, signals, recommendation: TIER_RECOMMENDATION[tier], checked };
}
