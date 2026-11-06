import { describe, it, expect } from "vitest";
import * as E from "../lib/enums";
import * as L from "../lib/labels";

function expectAll(values: readonly string[], table: Record<string, string>, name: string) {
  for (const v of values) expect(table[v], `${name} missing label for "${v}"`).toBeTruthy();
}

describe("labels cover every enum", () => {
  it("case states", () => expectAll(E.CASE_STATES, L.STATE_LABELS, "STATE_LABELS"));
  it("case summaries", () => { for (const s of E.CASE_STATES) expect(L.caseSummary(s).length).toBeGreaterThan(10); });
  it("account statuses", () => expectAll(E.ACCOUNT_STATUSES, L.ACCOUNT_STATUS_LABELS, "ACCOUNT_STATUS_LABELS"));
  it("trust levels + tooltips", () => { expectAll(E.TRUST_LEVELS, L.TRUST_LABELS, "TRUST_LABELS"); expectAll(E.TRUST_LEVELS, L.TRUST_TOOLTIPS, "TRUST_TOOLTIPS"); });
  it("pay refusals", () => expectAll(E.PAY_REFUSALS, L.REFUSAL_LABELS, "REFUSAL_LABELS"));
  it("release refusals", () => expectAll(E.RELEASE_REFUSALS, L.REFUSAL_LABELS, "REFUSAL_LABELS"));
  it("reject reasons", () => expectAll(E.REJECT_REASONS, L.REJECT_LABELS, "REJECT_LABELS"));
  it("human reasons", () => expectAll(E.HUMAN_REASONS, L.HUMAN_REASON_LABELS, "HUMAN_REASON_LABELS"));
  it("trigger types", () => expectAll(E.TRIGGER_TYPES, L.TRIGGER_LABELS, "TRIGGER_LABELS"));
  it("actors", () => expectAll(E.ACTORS, L.ACTOR_LABELS, "ACTOR_LABELS"));
  it("channels", () => expectAll(E.CHANNELS, L.CHANNEL_LABELS, "CHANNEL_LABELS"));
  it("probe/landing/invoice/contact/intake", () => {
    expectAll(E.PROBE_STATES, L.PROBE_STATE_LABELS, "PROBE_STATE_LABELS");
    expectAll(E.LANDING_STATES, L.LANDING_LABELS, "LANDING_LABELS");
    expectAll(E.INVOICE_STATUSES, L.INVOICE_STATUS_LABELS, "INVOICE_STATUS_LABELS");
    expectAll(E.CONTACT_KINDS, L.CONTACT_KIND_LABELS, "CONTACT_KIND_LABELS");
    expectAll(E.INTAKE_STATUSES, L.INTAKE_STATUS_LABELS, "INTAKE_STATUS_LABELS");
  });
  it("every event type emitted by convex/", () => expectAll(E.EVENT_TYPES, L.EVENT_LABELS, "EVENT_LABELS"));
  it("enum mirrors match the guard's refusal unions (spot check)", () => {
    expect(E.PAY_REFUSALS).toContain("destination_not_verified");
    expect(E.RELEASE_REFUSALS).toContain("received_before_available");
  });
});
