// Plain-English definitions for finance and protocol terms. Rendered by <Term k="..."> as a hover tooltip.
export const TERMS: Record<string, { label: string; definition: string }> = {
  dmarc: { label: "DMARC", definition: "An email check that confirms a message really came from the domain in the From address. A fraudster who has taken over a vendor's mailbox passes it; that is why Landed never treats a passing email as proof." },
  spf_dkim: { label: "SPF/DKIM", definition: "Two email authentication checks (sender IP and message signature). Together with DMARC they verify the sending domain, not the person or the account details inside." },
  ach: { label: "ACH", definition: "The US bank-to-bank network most vendor payments use. Same Day ACH settles in three windows (1:00, 5:00 and 6:00 pm ET); first-window credits must be visible to the receiver by 1:30 pm their local time." },
  same_day_ach: { label: "Same Day ACH", definition: "ACH payments that settle the same business day, in fixed windows. Landed queues the probe for the next window and times availability from it." },
  probe: { label: "probe", definition: "A randomized deposit between 11 and 99 cents sent to the requested account. Only the vendor's contact of record, reading their own bank statement, can state the exact amount. The amount never leaves the server." },
  micro_entry: { label: "Micro-Entry", definition: "Nacha's name for a sub-dollar ACH credit used to validate an account: under $1, memo ACCTVERIFY, originator subject to fraud monitoring. The probe follows this pattern." },
  contact_of_record: { label: "contact of record", definition: "A phone number or portal login established with the vendor at onboarding and never taken from a request email. Only this contact can confirm a probe." },
  vendor_master: { label: "vendor record", definition: "The company's stored profile for a vendor, including the bank account it pays. Business email compromise works by getting that one field changed." },
  sla: { label: "SLA", definition: "The window the vendor has to state the probe amount after it becomes available (24 hours here). If it passes with no statement, the case goes to a human and the invoice stays held." },
  rail: { label: "rail", definition: "The bank integration that actually moves money. Here a simulated ledger by default, or the Capital One Nessie mock bank when selected." },
  bec: { label: "business email compromise", definition: "Fraud where an attacker, from a compromised or lookalike vendor mailbox, asks accounts payable to send payments to a new bank account. $3.05 billion in reported US losses in 2025." },
  landing: { label: "landing", definition: "After a payment is sent, Landed asks the contact of record for the full amount that arrived. A match closes the case; a missed deadline starts recovery." },
  accounts_payable: { label: "accounts payable", definition: "The team in a company that pays vendor invoices. They pay to whatever bank account is stored in the vendor record." },
};

export type TermKey = keyof typeof TERMS;
