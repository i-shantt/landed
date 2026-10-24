import { describe, it, expect } from "vitest";
import { canPay, isAllowedTransition } from "../convex/guard";
import { mkAccount, mkInvoice, vendorB } from "./fixtures";

describe("canPay (I1)", () => {
  it("happy path: open invoice, verified destination, current version", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount(), currentVersionForIdentity: 1 })).toEqual({ ok: true });
  });
  it("invoice_missing", () => {
    expect(canPay({ invoice: null, destination: mkAccount(), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "invoice_missing" });
  });
  it("invoice_not_open", () => {
    expect(canPay({ invoice: mkInvoice({ status: "paid" }), destination: mkAccount(), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "invoice_not_open" });
  });
  it("destination_missing", () => {
    expect(canPay({ invoice: mkInvoice(), destination: null, currentVersionForIdentity: null })).toEqual({ ok: false, reason: "destination_missing" });
  });
  it("destination_vendor_mismatch", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ vendorId: vendorB }), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "destination_vendor_mismatch" });
  });
  it("destination_not_verified (unverified)", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ status: "unverified" }), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "destination_not_verified" });
  });
  it("destination_not_verified (probing)", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ status: "probing" }), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "destination_not_verified" });
  });
  it("destination_not_verified (rejected)", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ status: "rejected" }), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "destination_not_verified" });
  });
  it("destination_disputed", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ status: "disputed" }), currentVersionForIdentity: 1 })).toEqual({ ok: false, reason: "destination_disputed" });
  });
  it("destination_superseded", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ status: "superseded" }), currentVersionForIdentity: 2 })).toEqual({ ok: false, reason: "destination_superseded" });
  });
  it("destination_stale_version", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount({ version: 1 }), currentVersionForIdentity: 2 })).toEqual({ ok: false, reason: "destination_stale_version" });
  });
  it("destination_stale_version when identity unknown", () => {
    expect(canPay({ invoice: mkInvoice(), destination: mkAccount(), currentVersionForIdentity: null })).toEqual({ ok: false, reason: "destination_stale_version" });
  });
});

describe("transition table", () => {
  it("allows the documented edges", () => {
    expect(isAllowedTransition("HELD", "PROBE_SENT")).toBe(true);
    expect(isAllowedTransition("AWAITING_CONFIRMATION", "VERIFIED")).toBe(true);
    expect(isAllowedTransition("NEEDS_HUMAN", "VERIFIED")).toBe(true);
    expect(isAllowedTransition("PAID", "UNCONFIRMED")).toBe(true);
  });
  it("refuses undocumented edges", () => {
    expect(isAllowedTransition("HELD", "VERIFIED")).toBe(false);
    expect(isAllowedTransition("HELD", "PAID")).toBe(false);
    expect(isAllowedTransition("CLOSED", "HELD")).toBe(false);
    expect(isAllowedTransition("VERIFIED", "HELD")).toBe(false);
  });
});
