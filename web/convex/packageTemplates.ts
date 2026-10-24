// Deterministic recovery-package fields and template prose. No LLM required.
// (Claude-generated prose with numeric verification is added in Tier 3.)
import type { Doc } from "./_generated/dataModel";

export type PackageContext = {
  caseDoc: Doc<"cases">;
  vendor: Doc<"vendors"> | null;
  account: { routing: string; last4: string; version: number; status: string } | null;
  payment: Doc<"payments"> | null;
  invoice: Doc<"invoices"> | null;
  company: Doc<"company"> | null;
  companyAccount: { routing: string; last4: string };
  events: { at: number; actor: string; type: string }[];
  now: number;
};

export const HOUR = 3600_000;

export function fmtUsd(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "n/a";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtTime(t: number | null | undefined) {
  if (!t) return "n/a";
  return new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function buildFields(info: PackageContext) {
  const p = info.payment;
  const amountCents = p?.amountCents ?? null;
  const sentAt = p?.sentAt ?? null;
  const international = false;
  const amountAtLeast50k = (amountCents ?? 0) >= 5_000_000;
  const within72h = sentAt !== null ? info.now - sentAt <= 72 * HOUR : false;
  return {
    caseId: info.caseDoc._id,
    caseState: info.caseDoc.state,
    companyName: info.company?.name ?? "Company",
    vendorName: info.vendor?.name ?? "Vendor",
    paymentDate: fmtTime(sentAt),
    paymentSentAt: sentAt,
    amountCents,
    amount: fmtUsd(amountCents),
    rail: p?.rail ?? "none",
    railRef: p?.railRef ?? (p ? "PENDING-TRACE" : "no payment was sent"),
    railRefLabel: p?.rail === "wire" ? "IMAD/OMAD" : "ACH trace number",
    invoiceNumber: info.invoice?.number ?? "n/a",
    sendingRouting: info.companyAccount.routing,
    sendingLast4: info.companyAccount.last4,
    receivingRouting: info.account?.routing ?? "n/a",
    receivingLast4: info.account?.last4 ?? "n/a",
    hoursSincePayment: sentAt !== null ? Math.round(((info.now - sentAt) / HOUR) * 10) / 10 : null,
    eligibility: {
      international,
      amountAtLeast50k,
      within72h,
      killChainCriteriaMet: international && amountAtLeast50k && within72h,
      note: "As published for the FBI international Financial Fraud Kill Chain; confirm with your bank and IC3. The Recovery Asset Team also works domestic cases.",
    },
    timeline: info.events.map((e) => ({ at: e.at, atText: fmtTime(e.at), actor: e.actor, type: e.type })),
    generatedAt: info.now,
    sections: {} as Record<string, string>,
  };
}

export type PackageFields = ReturnType<typeof buildFields>;

export function templateSections(f: PackageFields): Record<string, string> {
  const paymentLine = f.amountCents !== null
    ? `${f.companyName} sent ${f.amount} by ${f.rail.toUpperCase()} on ${f.paymentDate} (${f.railRefLabel}: ${f.railRef}) from account ending ${f.sendingLast4} (routing ${f.sendingRouting}) to an account ending ${f.receivingLast4} at routing ${f.receivingRouting}, believed to belong to ${f.vendorName} per invoice ${f.invoiceNumber}.`
    : `No payment was sent. The destination account ending ${f.receivingLast4} at routing ${f.receivingRouting} was held by Landed before any funds moved.`;

  return {
    "Bank fraud-line script": [
      `"Hello, I am calling from ${f.companyName} to report a suspected business email compromise payment and request a recall."`,
      ``,
      paymentLine,
      ``,
      `"The vendor's contact of record did not confirm receipt. We believe the destination is a fraudster-controlled account. Please initiate a recall or return request to the receiving bank at routing ${f.receivingRouting}, flag the beneficiary account ending ${f.receivingLast4}, and tell me the case or reference number you assign. We are filing with the FBI IC3 today."`,
      ``,
      `Have ready: ${f.railRefLabel} ${f.railRef}, amount ${f.amount}, send date ${f.paymentDate}, your account ending ${f.sendingLast4}.`,
    ].join("\n"),

    "Indemnification letter draft": [
      `To: Fraud Department, receiving institution (routing ${f.receivingRouting})`,
      `From: ${f.companyName}`,
      `Re: Request for return of funds, ${f.railRefLabel} ${f.railRef}`,
      ``,
      `${f.companyName} requests the return of ${f.amount} sent on ${f.paymentDate} to the account ending ${f.receivingLast4}. The payment instruction was induced by a fraudulent change of bank details purporting to come from ${f.vendorName}. ${f.companyName} agrees to indemnify and hold harmless the receiving institution for returning the available funds in good faith.`,
      ``,
      `Authorized signature: ______________________   Date: __________`,
      ``,
      `(Draft for review by counsel. Recovery is never guaranteed; under Nacha rules the receiving bank may return a fraudulent ACH credit but is never required to. Wires are irrevocable.)`,
    ].join("\n"),

    "IC3 narrative": [
      `Complaint type: Business Email Compromise (vendor payment redirection).`,
      ``,
      `${paymentLine}`,
      ``,
      `The change of bank account was requested through the email channel. Landed's verification (a randomized sub-dollar probe deposit confirmed with the vendor's contact of record) ${f.amountCents !== null ? "was bypassed or the landing of the full payment could not be confirmed by the contact of record" : "was not completed; the contact of record did not confirm the probe"}. Case id: ${f.caseId}. Case state: ${f.caseState}.`,
      ``,
      `Hours since payment: ${f.hoursSincePayment ?? "n/a"}. Kill Chain criteria (international, >= $50,000, within 72h): ${f.eligibility.killChainCriteriaMet ? "met" : "not all met"}. ${f.eligibility.note}`,
    ].join("\n"),

    "Evidence preservation checklist": [
      `- Export the full email thread (headers included) that requested the bank change; do not forward, export.`,
      `- Preserve the invoice PDF and its metadata.`,
      `- Export the Landed case timeline (below) and the audit events.`,
      `- Record who clicked Pay, when, and from which workstation.`,
      `- Freeze the vendor record; do not edit the bank account rows (they are versioned).`,
      `- Notify the real vendor via the phone number of record, not by replying to the thread.`,
    ].join("\n"),

    "Insurer notice": [
      `Notify your cyber/crime insurer within the policy's notice window (often 24-72 hours). Reference the IC3 complaint number once filed. Provide this package's timeline and the bank's recall reference.`,
    ].join("\n"),

    Timeline: f.timeline.map((e) => `- ${e.atText}  ${e.actor.padEnd(6)}  ${e.type}`).join("\n"),
  };
}

export async function renderMarkdown(fields: PackageFields): Promise<{ markdown: string; prose: "template" | "claude" }> {
  const sections = templateSections(fields);
  fields.sections = sections;
  const header = [
    `# Recovery package: ${fields.vendorName} (case ${fields.caseId})`,
    ``,
    `> Prepared response package. A human reviews, signs, and makes the call. Recovery is never guaranteed.`,
    ``,
    `Generated ${fmtTime(fields.generatedAt)}. Recovery odds are best within 24 hours and collapse after 72 hours.`,
    ``,
  ].join("\n");
  const body = Object.entries(sections).map(([k, v]) => `## ${k}\n\n${v}\n`).join("\n");
  return { markdown: header + body, prose: "template" };
}
