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
  discovered_contact_added: "Discovered contact added",
  untrusted_contact_recorded: "Untrusted contact from the request recorded",
  message_received: "Email received",
  instruction_change_from_unknown_sender: "Bank change from an unknown sender",
  invoice_recorded: "Invoice recorded",
  voice_call_refused: "Voice call refused (number not in test list)",
  voice_call_not_implemented: "Voice channel not wired",
  voice_webhook_received: "Voice webhook received",
  seeded: "Fixtures seeded",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export const REJECT_LABELS: Record<string, string> = {
  untrusted_channel: "Ignored: came through the untrusted email channel",
  contact_not_record: "Ignored: contact is not the contact of record",
  contact_superseded: "Ignored: the contact of record was superseded",
  contact_missing: "Ignored: no contact attached",
  contact_wrong_vendor: "Ignored: contact belongs to another vendor",
  no_answer: "No answer (voicemail); will retry before the SLA",
};

export function rejectLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REJECT_LABELS[reason] ?? reason.replace(/_/g, " ");
}

export const REFUSAL_LABELS: Record<string, string> = {
  destination_missing: "Destination account does not exist",
  destination_vendor_mismatch: "Destination account belongs to a different vendor",
  destination_not_verified: "Destination account is not verified for this vendor",
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
  received_before_available: "Statement arrived before the funds were available",
};

export function refusalLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return REFUSAL_LABELS[reason] ?? reason.replace(/_/g, " ");
}

export const HUMAN_REASON_LABELS: Record<string, string> = {
  contact_and_bank_changed_together: "Bank account and contact changed in the same request",
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
  manual_edit: "Bank account edited by a clerk",
  never_verified_account: "Account never verified",
};

export const ACTOR_LABELS: Record<string, string> = {
  agent: "🤖 agent",
  human: "🧑 human",
  rail: "🏦 rail",
  vendor: "📞 vendor",
  system: "⚙️ system",
};
