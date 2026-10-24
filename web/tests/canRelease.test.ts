import { describe, it, expect } from "vitest";
import { canRelease } from "../convex/guard";
import { mkAccount, mkCase, mkConfirmation, mkContact, mkProbe, T0, caseB, vendorB, probeB } from "./fixtures";

const NOW = T0 + 7400_000;
const base = () => ({ caseDoc: mkCase(), account: mkAccount(), probe: mkProbe(), confirmation: mkConfirmation(), contact: mkContact(), now: NOW });

describe("canRelease (I3)", () => {
  it("happy path", () => {
    expect(canRelease(base())).toEqual({ ok: true });
  });
  it("no_confirmation", () => {
    expect(canRelease({ ...base(), confirmation: null })).toEqual({ ok: false, reason: "no_confirmation" });
  });
  it("case_mismatch (replayed confirmation from another case)", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ caseId: caseB }) })).toEqual({ ok: false, reason: "case_mismatch" });
  });
  it("vendor_mismatch", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ vendorId: vendorB }) })).toEqual({ ok: false, reason: "vendor_mismatch" });
  });
  it("account_hash_mismatch", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ accountHash: "other" }) })).toEqual({ ok: false, reason: "account_hash_mismatch" });
  });
  it("account_version_mismatch (account edited while confirmation pending)", () => {
    expect(canRelease({ ...base(), account: mkAccount({ version: 2 }) })).toEqual({ ok: false, reason: "account_version_mismatch" });
  });
  it("probe_mismatch (confirmation references a different probe)", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ probeId: probeB }) })).toEqual({ ok: false, reason: "probe_mismatch" });
  });
  it("probe_mismatch (no probe)", () => {
    expect(canRelease({ ...base(), probe: null })).toEqual({ ok: false, reason: "probe_mismatch" });
  });
  it("probe_not_available (settled only)", () => {
    expect(canRelease({ ...base(), probe: mkProbe({ state: "settled", availableAt: undefined }) })).toEqual({ ok: false, reason: "probe_not_available" });
  });
  it("amount_mismatch", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ statedAmountCents: 38 }) })).toEqual({ ok: false, reason: "amount_mismatch" });
  });
  it("amount_mismatch when nothing stated", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ statedAmountCents: undefined }) })).toEqual({ ok: false, reason: "amount_mismatch" });
  });
  it("contact_missing", () => {
    expect(canRelease({ ...base(), contact: null })).toEqual({ ok: false, reason: "contact_missing" });
  });
  it("contact_not_record (discovered)", () => {
    expect(canRelease({ ...base(), contact: mkContact({ trustLevel: "discovered" }) })).toEqual({ ok: false, reason: "contact_not_record" });
  });
  it("contact_not_record (untrusted)", () => {
    expect(canRelease({ ...base(), contact: mkContact({ trustLevel: "untrusted" }) })).toEqual({ ok: false, reason: "contact_not_record" });
  });
  it("contact_superseded", () => {
    expect(canRelease({ ...base(), contact: mkContact({ supersededAt: NOW - 1 }) })).toEqual({ ok: false, reason: "contact_superseded" });
  });
  it("confirmation_not_accepted", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ accepted: false, rejectReason: "untrusted_channel" }) })).toEqual({ ok: false, reason: "confirmation_not_accepted" });
  });
  it("confirmation_used", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ usedAt: NOW - 10 }) })).toEqual({ ok: false, reason: "confirmation_used" });
  });
  it("received_before_available", () => {
    expect(canRelease({ ...base(), confirmation: mkConfirmation({ receivedAt: T0 + 7100_000 }) })).toEqual({ ok: false, reason: "received_before_available" });
  });
  it("confirmation_expired", () => {
    expect(canRelease({ ...base(), now: T0 + 7300_000 + 3 * 3600_000 })).toEqual({ ok: false, reason: "confirmation_expired" });
  });
});
