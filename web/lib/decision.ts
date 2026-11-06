// Decision helper for cases in NEEDS_HUMAN. Pure: takes what the case page already loads and returns text.
// It never calls a mutation and never changes what the guard will accept; the three exits (reject change,
// mark fraud, exceptional release) stay the human actions they were, this only orders and explains them.
import { humanReasonLabel } from "./labels";

export type RiskTier = "low" | "elevated" | "high" | "critical";
export type ScreeningStatus = "unknown" | "clear" | "potential_match" | "confirmed_match" | "false_positive";
export type TrustBand = "new" | "building" | "established" | "trusted";
export type DecisionAction = "reject_change" | "mark_fraud" | "exceptional_release";
export type Fit = "recommended" | "possible" | "discouraged";
export type Tone = "neutral" | "good" | "warn" | "bad";

export type DecisionInput = {
  /** `cases.humanReason`: one of the escalation ids, or the operator's own words after "Request human review". */
  reason: string | null;
  risk: { score: number; tier: RiskTier; signals: { title: string }[] } | null;
  screening: ScreeningStatus;
  trustBand: TrustBand | null;
  /** Vendor statements on this case: accepted ones came from the contact of record; rejected ones did not. */
  confirmations: { accepted: number; rejected: number };
  /** From the `escalated` event payload when the reason was account reuse. */
  otherVendors: number | null;
  amountAtStakeCents: number;
};

export type DecisionOption = { action: DecisionAction; fit: Fit; why: string };
export type DecisionFact = { label: string; value: string; tone: Tone };
export type Decision = {
  /** The pattern this case matches: what a reviewer should believe before choosing. */
  headline: string;
  facts: DecisionFact[];
  /** Exactly three options, recommended first, exactly one recommended. */
  options: DecisionOption[];
  /** What to do outside the system before deciding. */
  nextStep: string;
};

export const ESCALATION_IDS = new Set([
  "contact_and_bank_changed_together",
  "account_previously_rejected",
  "account_reused_across_vendors",
  "validation_mismatch",
  "stated_amount_mismatch",
  "vendor_reports_nothing_arrived",
  "sla_expired",
  "portal_attempts_exhausted",
  "repeated_assistant_leak",
]);

export const ACTION_LABELS: Record<DecisionAction, string> = {
  reject_change: "Reject the change",
  mark_fraud: "Mark fraud",
  exceptional_release: "Exceptional release",
};
export const FIT_LABELS: Record<Fit, string> = { recommended: "Recommended", possible: "Possible", discouraged: "Discouraged" };

const HOSTILE_REASONS = new Set(["vendor_reports_nothing_arrived", "account_reused_across_vendors", "account_previously_rejected", "repeated_assistant_leak"]);
const STALL_REASONS = new Set(["sla_expired", "portal_attempts_exhausted"]);

type Pattern = "hostile" | "stall" | "unresolved";

function classify(i: DecisionInput): Pattern {
  const tier = i.risk?.tier ?? null;
  const reason = i.reason ?? "";
  if (i.screening === "confirmed_match") return "hostile";
  if (tier === "critical") return "hostile";
  if (HOSTILE_REASONS.has(reason)) return "hostile";
  if (reason === "stated_amount_mismatch" && tier === "high") return "hostile";
  if (STALL_REASONS.has(reason) && (tier === "low" || tier === "elevated") && i.screening !== "potential_match") return "stall";
  return "unresolved";
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function decisionHelper(i: DecisionInput): Decision {
  const pattern = classify(i);
  const reasonText = i.reason ? (ESCALATION_IDS.has(i.reason) ? humanReasonLabel(i.reason) : `Operator request: “${i.reason}”`) : "Escalated without a recorded reason";
  const tier = i.risk?.tier ?? null;
  const highRisk = tier === "high" || tier === "critical";
  const screeningBad = i.screening === "confirmed_match" || i.screening === "potential_match";

  const facts: DecisionFact[] = [
    { label: "Why it stopped", value: reasonText, tone: pattern === "hostile" ? "bad" : "warn" },
    {
      label: "Risk",
      value: i.risk ? `${i.risk.score}/100 ${i.risk.tier}${i.risk.signals[0] ? ` · ${i.risk.signals[0].title}` : ""}` : "not computed yet",
      tone: !i.risk ? "neutral" : highRisk ? "bad" : tier === "elevated" ? "warn" : "good",
    },
    {
      label: "Sanctions screening",
      value: i.screening === "unknown" ? "not screened" : i.screening.replace(/_/g, " "),
      tone: i.screening === "confirmed_match" ? "bad" : i.screening === "potential_match" ? "warn" : i.screening === "unknown" ? "neutral" : "good",
    },
    {
      label: "Beneficiary trust",
      value: i.trustBand ?? "unknown",
      tone: i.trustBand === "trusted" || i.trustBand === "established" ? "good" : i.trustBand === "new" ? "warn" : "neutral",
    },
    {
      label: "Vendor statements",
      value: i.confirmations.accepted + i.confirmations.rejected === 0 ? "none yet" : `${i.confirmations.accepted} from the contact of record, ${i.confirmations.rejected} ignored`,
      tone: i.confirmations.rejected > 0 && i.confirmations.accepted === 0 ? "warn" : "neutral",
    },
    { label: "Held back", value: i.amountAtStakeCents > 0 ? `${usd(i.amountAtStakeCents)} in open invoices` : "no open invoice remits here", tone: "neutral" },
  ];
  if (i.otherVendors) facts.push({ label: "Same account elsewhere", value: `${i.otherVendors} other vendor${i.otherVendors === 1 ? "" : "s"}`, tone: "bad" });

  let headline: string;
  let nextStep: string;
  let options: DecisionOption[];

  if (pattern === "hostile") {
    headline =
      i.screening === "confirmed_match"
        ? "The vendor matches a sanctions entry; nothing should be paid to this name on any account."
        : i.reason === "vendor_reports_nothing_arrived"
          ? "The vendor of record never saw the probe: the new account is not theirs."
          : i.reason === "account_reused_across_vendors" || i.reason === "account_previously_rejected"
            ? "This account number already has a bad history; a second probe would not change that."
            : "The signals point to a hostile request rather than a mistake.";
    nextStep = "Call the vendor on the number recorded before this request, tell them what was received, and preserve the email headers before anything else changes.";
    options = [
      { action: "mark_fraud", fit: "recommended", why: "Disputes the destination, opens recovery and drafts the bank, insurer and IC3 package while the evidence is fresh." },
      { action: "reject_change", fit: "possible", why: "If the vendor confirms on the old number that they sent nothing, rejecting restores the verified account without a recovery file." },
      { action: "exceptional_release", fit: "discouraged", why: "Two approvers would be overriding a vendor statement or a watchlist hit; the guard would log it against both names." },
    ];
  } else if (pattern === "stall") {
    headline = "Nothing hostile fired; the vendor simply did not answer in time.";
    nextStep = "Ask the contact of record to resubmit the change (a fresh request issues a new probe) or to read the deposit back on a recorded call.";
    options = [
      { action: "reject_change", fit: "recommended", why: "Keeps the verified account in place; the vendor can send the change again and the probe path starts clean." },
      { action: "exceptional_release", fit: i.trustBand === "trusted" || i.trustBand === "established" ? "possible" : "discouraged", why: i.trustBand === "trusted" || i.trustBand === "established" ? "A long-standing beneficiary with a clear screen; two approvers may release on a statement taken outside the system, with the note recorded." : "A new beneficiary with no landed history should not be released without a statement from the contact of record." },
      { action: "mark_fraud", fit: "discouraged", why: "No signal says the request was hostile; a recovery file would be noise for the bank and the vendor." },
    ];
  } else {
    headline =
      i.reason === "contact_and_bank_changed_together"
        ? "Bank and contact changed in one request, so the system has no trusted way to reach the vendor."
        : i.reason === "validation_mismatch"
          ? "The account-validation provider says the name on this account does not match the vendor."
          : i.reason === "stated_amount_mismatch"
            ? "The contact of record read back a different amount: either a misread or someone else sees that account."
            : "A person asked for review; the automated path has nothing further to try.";
    nextStep = "Reach the vendor through a channel that predates this request (the old phone number, the portal credential) and have them read the deposit back.";
    options = [
      { action: "reject_change", fit: "recommended", why: "Restores the account of record; the vendor can resubmit through the portal or the old number once the contact is re-attested." },
      { action: "mark_fraud", fit: highRisk || screeningBad ? "possible" : "discouraged", why: highRisk || screeningBad ? "Risk or screening already points the same way; mark fraud if the old-number call confirms the vendor sent nothing." : "Nothing beyond the escalation itself says the request was hostile; confirm on the old number before disputing." },
      { action: "exceptional_release", fit: !highRisk && !screeningBad && (i.trustBand === "trusted" || i.trustBand === "established") && i.confirmations.accepted > 0 ? "possible" : "discouraged", why: !highRisk && !screeningBad && (i.trustBand === "trusted" || i.trustBand === "established") && i.confirmations.accepted > 0 ? "An established beneficiary whose contact of record did answer; two approvers may release with the out-of-band statement in the note." : "Release should follow a statement from the contact of record, not replace it." },
    ];
  }
  const order: Record<Fit, number> = { recommended: 0, possible: 1, discouraged: 2 };
  options.sort((a, b) => order[a.fit] - order[b.fit]);
  return { headline, facts, options, nextStep };
}
