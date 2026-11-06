// Operator dispositions as training labels, derived on read. Pure: no ctx, no writes.
//
// A payment earns a label from what happened after it was sent, never from the model that scored it:
//   1  (suspicious)  the payment is `unconfirmed` (landing deadline passed or an operator marked fraud), or its case
//                    reached RECOVERY / UNCONFIRMED, or a human filed `fraud_reported` on its case;
//   0  (benign)      the payment `landed` (rail confirmation or an operator attested landing) and no fraud report exists;
//   null             still pending: not exported.
// The export pairs each label with the feature vector the model saw at send time (history strictly before sentAt),
// so a retraining run on operator feedback reads exactly what production read.

export type LabelSource = "landed" | "attested_landed" | "unconfirmed" | "fraud_reported" | "case_recovery";

export type Disposition = { label: 0 | 1; source: LabelSource; decidedAt: number | null };

export type LabelEvent = { type: string; at: number; payload?: unknown };

const method = (e: LabelEvent) => (e.payload as { method?: string } | null | undefined)?.method;

export function dispositionFor(args: {
  landingState: "pending" | "landed" | "unconfirmed";
  caseState: string | null;
  caseEvents: LabelEvent[];     // every event on the payment's case (empty when the payment had no case)
  paymentEvents: LabelEvent[];  // the subset whose payload names this payment
}): Disposition | null {
  const fraud = args.caseEvents.find((e) => e.type === "fraud_reported");
  if (fraud) return { label: 1, source: "fraud_reported", decidedAt: fraud.at };
  if (args.caseState === "RECOVERY" || args.caseState === "UNCONFIRMED") {
    const at = args.caseEvents.filter((e) => e.type === "recovery_started" || e.type === "landing_unconfirmed").map((e) => e.at).sort((a, b) => b - a)[0] ?? null;
    return { label: 1, source: "case_recovery", decidedAt: at };
  }
  if (args.landingState === "unconfirmed") {
    return { label: 1, source: "unconfirmed", decidedAt: args.paymentEvents.find((e) => e.type === "landing_unconfirmed")?.at ?? null };
  }
  if (args.landingState === "landed") {
    const landed = args.paymentEvents.filter((e) => e.type === "payment_landed").sort((a, b) => b.at - a.at)[0];
    if (landed && method(landed) === "operator_attestation") return { label: 0, source: "attested_landed", decidedAt: landed.at };
    return { label: 0, source: "landed", decidedAt: landed?.at ?? null };
  }
  return null;
}

export type LabelSummary = { labelled: number; positives: number; negatives: number; pending: number; bySource: Record<LabelSource, number> };

export function summariseLabels(rows: (Disposition | null)[]): LabelSummary {
  const s: LabelSummary = { labelled: 0, positives: 0, negatives: 0, pending: 0, bySource: { landed: 0, attested_landed: 0, unconfirmed: 0, fraud_reported: 0, case_recovery: 0 } };
  for (const d of rows) {
    if (!d) { s.pending++; continue; }
    s.labelled++;
    if (d.label === 1) s.positives++; else s.negatives++;
    s.bySource[d.source]++;
  }
  return s;
}
