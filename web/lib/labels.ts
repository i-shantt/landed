// The single source of plain-English copy. No raw enum string should reach the screen
// except as a secondary monospace token next to its label.

export const EVENT_LABELS: Record<string, string> = {
  case_opened: "Case opened",
  invoices_held: "Open invoices held",
  validation_result: "Validation provider checked",
  escalated: "Escalated to a human",
  probe_submitted: "Probe deposit submitted (ACCTVERIFY)",
  probe_resubmitted: "Probe deposit re-submitted",
  probe_accepted_by_rail: "Rail accepted the probe",
  probe_rail_error: "Rail error on probe",
  probe_settled: "Probe settled",
  probe_available: "Probe funds available to the vendor",
  awaiting_confirmation: "Awaiting the vendor's statement",
  portal_confirmation_opened: "Portal confirmation opened for the vendor",
  sim_voice_call_placed: "Simulated call placed to the number of record",
  sim_voice_waiting: "Simulated call: waiting for a vendor answer",
  sim_voice_statement_scripted: "Simulated vendor answer scripted",
  sim_voice_no_record_contact: "No phone number of record",
  no_record_contact: "No contact of record for this vendor",
  confirmation_received: "Vendor statement received",
  landing_statement_received: "Landing statement received",
  release_refused: "Release refused",
  account_verified: "Account verified for this vendor",
  old_account_superseded: "Previous account superseded",
  payment_refused: "Payment refused by the guard",
  payment_sent: "Payment sent",
  payment_accepted_by_rail: "Rail accepted the payment",
  payment_rail_error: "Rail error on payment",
  case_paid: "Case paid",
  payment_landed: "Vendor confirmed the payment landed",
  case_landed: "Payment landed",
  case_closed: "Case closed",
  landing_unconfirmed: "Landing not confirmed by the deadline",
  landing_mismatch: "Vendor stated a different landed amount",
  landing_statement_ignored: "Landing statement ignored",
  recovery_started: "Recovery started",
  package_generated: "Recovery package prepared",
  sla_expired: "Confirmation window expired",
  human_review_requested: "Human review requested",
  fraud_reported: "Fraud reported by a human",
  account_disputed: "Account marked disputed",
  exceptional_release: "Exceptional release by two approvers",
  change_rejected: "Bank change rejected by a human",
  bank_account_created: "New bank account recorded (unverified)",
  contact_superseded: "Contact superseded",
  record_contact_added: "Contact of record added",
  vendor_onboarded: "Vendor onboarded",
  portal_credential_issued: "Portal credential issued",
  eml_ingested: "Email file ingested (.eml)",
  attachment_received:
    "Attachment received (evidence only; documents never verify an account)",
  discovered_contact_added: "Discovered contact added (cross-check only)",
  contact_crosscheck_mismatch:
    "Discovered phone differs from the phone of record",
  untrusted_contact_recorded: "Untrusted contact from the request recorded",
  message_received: "Email received",
  instruction_change_from_unknown_sender: "Bank change from an unknown sender",
  sender_domain_mismatch: "Sender domain does not match the claimed vendor",
  invoice_recorded: "Invoice recorded",
  voice_call_refused: "Voice call refused (number not in test list)",
  voice_call_not_implemented: "Voice channel not wired",
  voice_call_placed: "Voice call placed",
  voice_call_failed: "Voice call failed",
  voice_no_statement: "Voice call ended without a statement",
  voice_webhook_received: "Voice webhook received",
  voice_dry_run: "Voice call built but not dialed (dry run)",
  agent_leaked_amount: "Voice agent said an amount; probe re-issued",
  seeded: "Fixtures seeded",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export const STATE_LABELS: Record<string, string> = {
  HELD: "On hold",
  PROBE_SENT: "Test deposit sent",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  VERIFIED: "Verified",
  PAID: "Paid",
  LANDED: "Landed",
  NEEDS_HUMAN: "Review required",
  UNCONFIRMED: "Receipt unconfirmed",
  RECOVERY: "Recovery",
  CLOSED: "Closed",
};
export function stateLabel(s: string): string {
  return STATE_LABELS[s] ?? s.replace(/_/g, " ").toLowerCase();
}

/** One sentence on where the case stands. */
export function caseSummary(
  state: string,
  humanReason?: string | null,
): string {
  switch (state) {
    case "HELD":
      return "The requested account is held. Nothing can be paid to it.";
    case "PROBE_SENT":
      return "A randomized sub-dollar probe deposit is queued to the requested account. Payments to it are blocked until the vendor of record reads the amount back.";
    case "AWAITING_CONFIRMATION":
      return "The probe has landed. Waiting for the vendor's contact of record to state the exact amount. Email cannot confirm.";
    case "VERIFIED":
      return "The contact of record stated the exact probe amount. The account is verified for this vendor and open invoices can be paid.";
    case "PAID":
      return "Payment sent. Waiting for the vendor of record to confirm the full amount landed.";
    case "LANDED":
      return "The vendor of record confirmed the payment landed.";
    case "NEEDS_HUMAN":
      return `Verification did not complete${humanReason ? `: ${humanReasonLabel(humanReason).toLowerCase()}` : ""}. A human decides; payments stay blocked.`;
    case "UNCONFIRMED":
      return "The landing deadline passed without confirmation. A recovery package is being prepared.";
    case "RECOVERY":
      return "Treated as fraud. The destination is disputed and the recovery package is ready for a human to act on.";
    case "CLOSED":
      return "This case is closed.";
    default:
      return "";
  }
}

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  unverified: "Unverified",
  probing: "Probe in flight",
  verified: "Verified",
  disputed: "Disputed",
  rejected: "Rejected",
  superseded: "Superseded",
};
export function accountStatusLabel(s: string): string {
  return ACCOUNT_STATUS_LABELS[s] ?? s;
}

export const TRUST_LABELS: Record<string, string> = {
  record: "Contact of record",
  discovered: "Discovered (cross-check only)",
  untrusted: "Untrusted (from a request)",
};
export const TRUST_TOOLTIPS: Record<string, string> = {
  record:
    "Established at onboarding on a verified channel. The only kind of contact that can confirm a probe.",
  discovered:
    "Found on the vendor's public website. Used only to cross-check the contact of record; it can never confirm anything.",
  untrusted:
    "Offered inside a request message (for example a new phone number in a bank-change email). Never used for verification.",
};
export function trustLabel(level: string): string {
  return TRUST_LABELS[level] ?? level;
}

export const REJECT_LABELS: Record<string, string> = {
  untrusted_channel: "Ignored: came through the untrusted email channel",
  contact_not_record: "Ignored: contact is not the contact of record",
  contact_superseded: "Ignored: the contact of record was superseded",
  contact_missing: "Ignored: no contact attached",
  contact_wrong_vendor: "Ignored: contact belongs to another vendor",
  no_answer: "No answer (voicemail); will retry before the SLA",
  agent_leaked_amount:
    "Discarded: the voice agent said an amount out loud; probe re-issued",
};

export function rejectLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REJECT_LABELS[reason] ?? reason.replace(/_/g, " ");
}

export const REFUSAL_LABELS: Record<string, string> = {
  destination_missing: "Destination account does not exist",
  destination_vendor_mismatch:
    "Destination account belongs to a different vendor",
  destination_not_verified:
    "Destination account is not verified for this vendor",
  destination_disputed: "Destination account is disputed",
  destination_superseded: "Destination account was superseded by a newer one",
  destination_stale_version: "Destination account version is stale",
  invoice_missing: "Invoice not found",
  invoice_not_open: "Invoice is not open",
  no_confirmation: "No confirmation on file",
  confirmation_not_accepted: "Confirmation was not accepted",
  confirmation_used: "Confirmation already used",
  confirmation_expired: "Confirmation expired",
  case_mismatch: "Confirmation belongs to another case",
  vendor_mismatch: "Confirmation belongs to another vendor",
  account_hash_mismatch: "Confirmation is for a different account",
  account_version_mismatch: "Confirmation is for an older account version",
  probe_mismatch: "Confirmation references a different probe",
  probe_not_available: "Probe funds are not yet available",
  amount_mismatch: "Stated amount did not match the probe",
  contact_not_record: "Contact is not the contact of record",
  contact_superseded: "Contact of record was superseded",
  contact_missing: "No contact attached",
  received_before_available:
    "Statement arrived before the funds were available",
  case_not_awaiting: "Case is not awaiting a confirmation",
};

export function refusalLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REFUSAL_LABELS[reason] ?? reason.replace(/_/g, " ");
}

export const HUMAN_REASON_LABELS: Record<string, string> = {
  contact_and_bank_changed_together:
    "Bank account and contact changed in the same request",
  stated_amount_mismatch: "Vendor of record stated a different amount",
  vendor_reports_nothing_arrived: "Vendor of record saw no deposit",
  sla_expired: "No vendor statement within the window",
  portal_attempts_exhausted: "Portal attempts exhausted",
  validation_mismatch: "Validation provider reported a mismatch",
};

export function humanReasonLabel(r: string | null | undefined): string {
  if (!r) return "";
  return HUMAN_REASON_LABELS[r] ?? r.replace(/_/g, " ");
}

export const TRIGGER_LABELS: Record<string, string> = {
  instruction_change: "Bank change requested by email",
  instruction_change_lookalike: "Bank change from a lookalike sender",
  manual_edit: "Bank account edited by a clerk",
  never_verified_account: "Account never verified",
};
export function triggerLabel(t: string): string {
  return TRIGGER_LABELS[t] ?? t.replace(/_/g, " ");
}

export const ACTOR_LABELS: Record<string, string> = {
  agent: "agent",
  human: "human",
  rail: "bank rail",
  vendor: "vendor",
  system: "system",
};
export function actorLabel(a: string): string {
  return ACTOR_LABELS[a] ?? a;
}

export const CHANNEL_LABELS: Record<string, string> = {
  voice: "Phone call",
  sim_voice: "Simulated call",
  portal: "Vendor portal",
  email: "Email",
};
export function channelLabel(c: string): string {
  return CHANNEL_LABELS[c] ?? c;
}

export const PROBE_STATE_LABELS: Record<string, string> = {
  submitted: "Submitted to the rail",
  settled: "Settled",
  available: "Available to the vendor",
  returned: "Returned",
};
export const LANDING_LABELS: Record<string, string> = {
  pending: "Pending",
  landed: "Landed",
  unconfirmed: "Unconfirmed",
};
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  paid: "Paid",
  held: "Held",
};
export const CONTACT_KIND_LABELS: Record<string, string> = {
  phone: "Phone",
  portal: "Portal login",
  email: "Email",
};
export const INTAKE_STATUS_LABELS: Record<string, string> = {
  pending: "Intake running",
  done: "Intake done",
  error: "Intake error",
};

export const EXTRACTOR_MODE_HELP: Record<string, string> = {
  claude:
    "Claude reads the email and PDFs with a strict extraction tool. It can only open a held case; it can never verify or pay.",
  rules:
    "A regex extractor (ABA checksum, account patterns, change phrases). No network.",
  off: "Intake records the message and extracts nothing. This is the AI-miss demo: the guard still refuses unverified destinations.",
};
export const RAIL_HELP: Record<string, string> = {
  sim: "SimRail: an in-database ledger. Settlement and availability are driven by the demo clock.",
  nessie:
    "Capital One Nessie sandbox (HTTPS). A credit is a deposit plus a withdrawal; amounts are integer cents.",
};
export const VOICE_HELP: Record<string, string> = {
  sim: "SimVoice: a human types what the vendor sees. Nothing is dialed.",
  vapi: "Vapi voice agent, test numbers only. The agent never knows the probe amount.",
};

/** Plain-English rendering of a timeline payload key/value. */
export function payloadLabel(key: string): string {
  const map: Record<string, string> = {
    reason: "reason",
    channel: "channel",
    accepted: "accepted",
    rejectReason: "why",
    outcome: "outcome",
    contactTrust: "contact",
    contactKind: "via",
    invoiceNumber: "invoice",
    amountCents: "amount",
    initiatedBy: "by",
    rail: "rail",
    railRef: "rail ref",
    triggerType: "trigger",
    newAccount: "new account",
    oldAccount: "prior account",
    destination: "destination",
    result: "result",
    provider: "provider",
    next: "next",
    expectedSettleAt: "settles",
    expectedAvailableAt: "available",
    slaDeadlineAt: "SLA",
    landingDeadlineAt: "landing deadline",
    attempts: "attempts",
    expiresAt: "expires",
    approverA: "approver A",
    approverB: "approver B",
    restoredInvoices: "invoices restored",
    invoices: "invoices",
    mode: "mode",
    retry: "retry",
    memo: "memo",
    version: "version",
    last4: "last 4",
    from: "from",
    vendorResolved: "vendor matched",
    dmarc: "DMARC",
    subject: "subject",
    confirmedAt: "confirmed",
    expectedCents: "expected",
    statedCents: "stated",
    evidence: "evidence",
    realDomain: "real domain",
    senderDomain: "sender domain",
  };
  return map[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
}
