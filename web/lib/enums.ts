// Explicit mirrors of the unions in convex/schema.ts and convex/guard.ts, used by
// the labels test to assert every value has plain-English copy. Keep in sync.
export const CASE_STATES = ["HELD", "PROBE_SENT", "AWAITING_CONFIRMATION", "VERIFIED", "PAID", "LANDED", "NEEDS_HUMAN", "UNCONFIRMED", "RECOVERY", "CLOSED"] as const;
export const ACCOUNT_STATUSES = ["unverified", "probing", "verified", "disputed", "rejected", "superseded"] as const;
export const TRUST_LEVELS = ["record", "discovered", "untrusted"] as const;
export const PAY_REFUSALS = ["destination_missing", "destination_vendor_mismatch", "destination_not_verified", "destination_disputed", "destination_superseded", "destination_stale_version", "invoice_missing", "invoice_not_open"] as const;
export const RELEASE_REFUSALS = ["no_confirmation", "confirmation_not_accepted", "confirmation_used", "confirmation_expired", "case_mismatch", "vendor_mismatch", "account_hash_mismatch", "account_version_mismatch", "probe_mismatch", "probe_not_available", "amount_mismatch", "contact_not_record", "contact_superseded", "contact_missing", "received_before_available", "case_not_awaiting"] as const;
export const REJECT_REASONS = ["untrusted_channel", "contact_missing", "contact_wrong_vendor", "contact_not_record", "contact_superseded", "no_answer", "agent_leaked_amount"] as const;
export const HUMAN_REASONS = ["contact_and_bank_changed_together", "validation_mismatch", "sla_expired", "stated_amount_mismatch", "vendor_reports_nothing_arrived", "portal_attempts_exhausted"] as const;
export const TRIGGER_TYPES = ["instruction_change", "instruction_change_lookalike", "manual_edit", "never_verified_account"] as const;
export const ACTORS = ["agent", "human", "rail", "vendor", "system"] as const;
export const CHANNELS = ["voice", "portal", "email", "sim_voice"] as const;
export const PROBE_STATES = ["submitted", "settled", "available", "returned"] as const;
export const LANDING_STATES = ["pending", "landed", "unconfirmed"] as const;
export const INVOICE_STATUSES = ["open", "paid", "held"] as const;
export const CONTACT_KINDS = ["phone", "portal", "email"] as const;
export const INTAKE_STATUSES = ["pending", "done", "error"] as const;
/** Every event type emitted by convex/ (grep `type: "` in convex/). */
export const EVENT_TYPES = [
  "account_disputed", "account_verified", "agent_leaked_amount", "awaiting_confirmation", "bank_account_created", "case_closed", "case_landed", "case_opened", "case_paid", "change_rejected", "confirmation_received", "contact_crosscheck_mismatch", "contact_superseded", "discovered_contact_added", "escalated", "exceptional_release", "fraud_reported", "human_review_requested", "instruction_change_from_unknown_sender", "invoice_recorded", "invoices_held", "landing_mismatch", "landing_statement_ignored", "landing_statement_received", "landing_unconfirmed", "message_received", "no_record_contact", "old_account_superseded", "package_generated", "payment_accepted_by_rail", "payment_landed", "payment_rail_error", "payment_refused", "payment_sent", "portal_confirmation_opened", "probe_accepted_by_rail", "probe_available", "probe_rail_error", "probe_resubmitted", "probe_settled", "probe_submitted", "record_contact_added", "recovery_started", "release_refused", "seeded", "sender_domain_mismatch", "sim_voice_call_placed", "sim_voice_no_record_contact", "sim_voice_statement_scripted", "sim_voice_waiting", "sla_expired", "untrusted_contact_recorded", "validation_result", "voice_call_failed", "voice_call_placed", "voice_call_refused", "voice_dry_run", "voice_no_statement", "voice_webhook_received",
] as const;
