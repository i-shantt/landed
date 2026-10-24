// Property-style tests: any valid confirmation releases; any single perturbed field refuses with the expected reason.
// Fuzz: 200 generated benign emails produce zero false positives, including routing+account pairs that fail the ABA checksum.
import { describe, it, expect } from "vitest";
import { canRelease } from "../convex/guard";
import { extractWithRules, abaChecksumOk } from "../convex/extractors/rules";
import { mkAccount, mkCase, mkConfirmation, mkContact, mkProbe, T0, caseB, vendorB, probeB } from "./fixtures";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("canRelease properties", () => {
  it("random valid confirmations always release", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const amount = 11 + Math.floor(r() * 89);
      const availableAt = T0 + Math.floor(r() * 1e7);
      const receivedAt = availableAt + 1 + Math.floor(r() * 3600_000);
      const version = 1 + Math.floor(r() * 5);
      const hash = `h${Math.floor(r() * 1e9)}`;
      const d = canRelease({
        caseDoc: mkCase(),
        account: mkAccount({ version, accountHash: hash }),
        probe: mkProbe({ amountCents: amount, availableAt, settledAt: availableAt - 1000 }),
        confirmation: mkConfirmation({ statedAmountCents: amount, accountVersion: version, accountHash: hash, receivedAt, expiresAt: receivedAt + 7200_000 }),
        contact: mkContact(),
        now: receivedAt + Math.floor(r() * 7000_000),
      });
      expect(d).toEqual({ ok: true });
    }
  });

  it("every single-field perturbation refuses with its own reason", () => {
    const base = () => ({ caseDoc: mkCase(), account: mkAccount(), probe: mkProbe(), confirmation: mkConfirmation(), contact: mkContact(), now: T0 + 7400_000 });
    const perturbations: [string, (a: ReturnType<typeof base>) => ReturnType<typeof base>, string][] = [
      ["confirmation.caseId", (a) => ({ ...a, confirmation: mkConfirmation({ caseId: caseB }) }), "case_mismatch"],
      ["confirmation.vendorId", (a) => ({ ...a, confirmation: mkConfirmation({ vendorId: vendorB }) }), "vendor_mismatch"],
      ["account.vendorId", (a) => ({ ...a, account: mkAccount({ vendorId: vendorB }) }), "vendor_mismatch"],
      ["confirmation.accountHash", (a) => ({ ...a, confirmation: mkConfirmation({ accountHash: "zz" }) }), "account_hash_mismatch"],
      ["account.version", (a) => ({ ...a, account: mkAccount({ version: 2 }) }), "account_version_mismatch"],
      ["confirmation.probeId", (a) => ({ ...a, confirmation: mkConfirmation({ probeId: probeB }) }), "probe_mismatch"],
      ["case.probeId", (a) => ({ ...a, caseDoc: mkCase({ probeId: probeB }) }), "probe_mismatch"],
      ["probe.state", (a) => ({ ...a, probe: mkProbe({ state: "settled" }) }), "probe_not_available"],
      ["amount", (a) => ({ ...a, confirmation: mkConfirmation({ statedAmountCents: 38 }) }), "amount_mismatch"],
      ["contact null", (a) => ({ ...a, contact: null }), "contact_missing"],
      ["contact.trustLevel", (a) => ({ ...a, contact: mkContact({ trustLevel: "discovered" }) }), "contact_not_record"],
      ["contact.supersededAt", (a) => ({ ...a, contact: mkContact({ supersededAt: T0 }) }), "contact_superseded"],
      ["confirmation.accepted", (a) => ({ ...a, confirmation: mkConfirmation({ accepted: false }) }), "confirmation_not_accepted"],
      ["confirmation.usedAt", (a) => ({ ...a, confirmation: mkConfirmation({ usedAt: T0 }) }), "confirmation_used"],
      ["confirmation.receivedAt early", (a) => ({ ...a, confirmation: mkConfirmation({ receivedAt: T0 + 7100_000 }) }), "received_before_available"],
      ["now past expiry", (a) => ({ ...a, now: T0 + 7300_000 + 3 * 3600_000 }), "confirmation_expired"],
      ["confirmation null", (a) => ({ ...a, confirmation: null }), "no_confirmation"],
    ];
    expect(canRelease(base())).toEqual({ ok: true });
    for (const [name, perturb, reason] of perturbations) {
      const d = canRelease(perturb(base()));
      expect(d, name).toEqual({ ok: false, reason });
    }
  });
});

describe("rules extractor fuzz", () => {
  it("200 generated benign emails: zero false positives, incl. ABA-invalid routing+account pairs", () => {
    const r = rng(42);
    const words = ["schedule", "invoice", "thanks", "October", "service", "site", "contract", "renewal", "PO", "delivery", "tracking", "weekly", "report", "meeting", "Friday"];
    const pick = () => words[Math.floor(r() * words.length)];
    const digits = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");
    let badRouting = 0;
    for (let i = 0; i < 200; i++) {
      // random 9-digit number that FAILS the ABA checksum, near banking keywords
      let routing = digits(9);
      while (abaChecksumOk(routing)) routing = digits(9);
      badRouting++;
      const acct = digits(8 + Math.floor(r() * 5));
      const kind = i % 4;
      const body =
        kind === 0 ? `Hi, ${pick()} ${pick()} ${pick()}. PO ${digits(10)} and tracking ${digits(12)}. No billing changes.`
        : kind === 1 ? `Reminder: our bank is closed Monday. Routing ${routing}, account ${acct} unchanged as on file.`
        : kind === 2 ? `Please find invoice INV-${digits(5)} for $${digits(4)}.00. Remit to our account on file. Phone (555) 010-${digits(4)}.`
        : `${pick()} ${pick()}: the ${pick()} is unchanged. Reference ${digits(7)}.`;
      const res = extractWithRules(body);
      expect(res.changed, body).toBe(false);
    }
    expect(badRouting).toBe(200);
  });

  it("still detects a real change with a valid routing number", () => {
    expect(extractWithRules("We have changed banks. Routing 011000015, account 900012345678.").changed).toBe(true);
  });
});
