// Caption lines for autoplay (/cases/[id]?autoplay=1). Wording follows DEMO.md section A.
// Keyed by event type; a few depend on the payload.
export function captionFor(type: string, payload: unknown): string | null {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  switch (type) {
    case "case_opened": return "A DMARC-clean email asked us to pay a new account. A case opens; the account starts unverified.";
    case "invoices_held": return "The open invoice now points at the requested account and is held. Nothing can be paid to it.";
    case "validation_result": return "No validation network covers this vendor. So we send a probe.";
    case "probe_submitted": return "A randomized sub-dollar deposit is queued for the next ACH window. The amount is secret from everyone but the vendor's bank statement.";
    case "probe_accepted_by_rail": return "The bank rail accepted the probe.";
    case "payment_refused": return `A clerk clicked Pay. The database refused: ${String(p.reason ?? "destination not verified").replace(/_/g, " ")}.`;
    case "probe_settled": return "The clock jumps to the ACH window. The probe settles.";
    case "probe_available": return "Funds are visible to the vendor. Now only the vendor of record can tell us the amount.";
    case "awaiting_confirmation": return "We call the phone number established at onboarding, never a number from the email.";
    case "portal_confirmation_opened": return "The vendor can also answer by logging in to their portal.";
    case "sim_voice_call_placed": return "The call is placed (simulated here).";
    case "sim_voice_waiting": return "Waiting for the vendor to read back the amount.";
    case "confirmation_received": {
      if (p.channel === "email") return "The attacker says the deposit arrived. Email cannot confirm anything.";
      if (p.outcome === "nothing_arrived") return "The vendor of record checked their statement: nothing arrived.";
      if (p.accepted) return "The vendor of record read back an amount through a trusted channel.";
      return "A statement arrived but was not accepted by the channel rules.";
    }
    case "release_refused": {
      const r = String(p.reason ?? "");
      if (r === "confirmation_not_accepted") return "The release gate ignores it. Only a bound statement from the contact of record counts.";
      if (r === "amount_mismatch") return "The gate compares the statement with the probe. No match. No release.";
      return `The release gate refused: ${r.replace(/_/g, " ")}.`;
    }
    case "escalated": return "The vendor of record saw no deposit. A human takes it from here. The money never moved.";
    case "account_verified": return "The amount matched. The account is verified for this vendor, atomically, in one transaction.";
    case "old_account_superseded": return "The previous account is superseded.";
    case "payment_sent": return "Pay now succeeds, to the verified account only.";
    case "case_paid": return "Paid. Now we confirm it actually landed.";
    case "landing_statement_received": return "The vendor of record states what arrived.";
    case "payment_landed": return "Landed. The vendor confirmed the full amount.";
    case "case_closed": return "Case closed.";
    case "change_rejected": return "A human rejected the change. The invoice goes back to the real account.";
    case "fraud_reported": return "A human marks fraud.";
    case "package_generated": return "The recovery package is ready: bank script, indemnification letter, IC3 narrative.";
    case "exceptional_release": return "Two named approvers overrode the gate. It is logged forever.";
    default: return null;
  }
}
