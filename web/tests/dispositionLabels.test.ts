// Operator dispositions as labels (monitoring/labels.ts): what happened after the payment decides, never the model.
import { describe, it, expect } from "vitest";
import { dispositionFor, summariseLabels } from "../convex/monitoring/labels";

const ev = (type: string, at: number, payload?: unknown) => ({ type, at, payload });

describe("dispositionFor", () => {
  it("pending payments have no label", () => {
    expect(dispositionFor({ landingState: "pending", caseState: "PAID", caseEvents: [], paymentEvents: [] })).toBeNull();
  });
  it("a fraud report outranks a landing", () => {
    const d = dispositionFor({ landingState: "landed", caseState: "UNCONFIRMED", caseEvents: [ev("payment_landed", 5), ev("fraud_reported", 9)], paymentEvents: [ev("payment_landed", 5)] });
    expect(d).toEqual({ label: 1, source: "fraud_reported", decidedAt: 9 });
  });
  it("recovery on the case labels the payment suspicious with the latest recovery time", () => {
    const d = dispositionFor({ landingState: "pending", caseState: "RECOVERY", caseEvents: [ev("landing_unconfirmed", 3), ev("recovery_started", 7)], paymentEvents: [] });
    expect(d).toEqual({ label: 1, source: "case_recovery", decidedAt: 7 });
  });
  it("an unconfirmed landing is suspicious; a rail landing is benign; an operator attestation is benign and says so", () => {
    expect(dispositionFor({ landingState: "unconfirmed", caseState: "LANDED", caseEvents: [], paymentEvents: [ev("landing_unconfirmed", 4)] })).toEqual({ label: 1, source: "unconfirmed", decidedAt: 4 });
    expect(dispositionFor({ landingState: "landed", caseState: "LANDED", caseEvents: [], paymentEvents: [ev("payment_landed", 6)] })).toEqual({ label: 0, source: "landed", decidedAt: 6 });
    expect(dispositionFor({ landingState: "landed", caseState: null, caseEvents: [], paymentEvents: [ev("payment_landed", 8, { method: "operator_attestation" })] })).toEqual({ label: 0, source: "attested_landed", decidedAt: 8 });
    expect(dispositionFor({ landingState: "landed", caseState: null, caseEvents: [], paymentEvents: [] })).toEqual({ label: 0, source: "landed", decidedAt: null });
  });
  it("summarises counts by label and source", () => {
    const s = summariseLabels([null, { label: 1, source: "fraud_reported", decidedAt: 1 }, { label: 0, source: "landed", decidedAt: 2 }, { label: 0, source: "attested_landed", decidedAt: 3 }]);
    expect(s).toMatchObject({ labelled: 3, positives: 1, negatives: 2, pending: 1 });
    expect(s.bySource).toMatchObject({ fraud_reported: 1, landed: 1, attested_landed: 1, unconfirmed: 0, case_recovery: 0 });
  });
});
