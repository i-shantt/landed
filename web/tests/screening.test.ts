import { describe, it, expect } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, pay, actors, asUser } from "./harness";
import { normalizeName, jaroWinkler, tokenSortRatio, scoreNames, classify, POTENTIAL_MATCH_THRESHOLD, STRONG_MATCH_THRESHOLD } from "../convex/screening/match";
import { DEMO_WATCHLIST, DEMO_LIST_VERSION, watchlistNames, parseSdnCsv, parseAltCsv, buildWatchlist } from "../convex/screening/watchlist";
import { screenName } from "../convex/screening/screen";
import fixtureData from "../convex/fixtureData.json";

type T = Awaited<ReturnType<typeof setup>>["t"];

const operators = actors; // signed-in clerk / approver / admin

// A vendor whose name is a deliberate near-miss of a demo watchlist entry, with a verified account
// and an open invoice so the payment path can be exercised. Shape copied from seed.insertFixture.
const NEAR_MISS_NAME = "Harborline Freight";
async function insertNearMissVendor(t: T) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const vendorId = await ctx.db.insert("vendors", { name: NEAR_MISS_NAME, domain: "harborline.example", slug: "harborline", onboardedAt: now - 100 * 86_400_000, hasPortalLogin: false });
    const accountHash = "testhash-harborline-0001";
    const accountId = await ctx.db.insert("bankAccounts", {
      vendorId,
      identityKey: `${vendorId}:${accountHash}`,
      version: 1,
      routing: "021000021",
      accountLast4: "4321",
      accountHash,
      accountCiphertext: "test-ciphertext",
      status: "verified",
      firstPaidAt: now - 50 * 86_400_000,
      createdVia: "seed",
    });
    const invoiceId = await ctx.db.insert("invoices", { vendorId, number: "HL-1001", amountCents: 125_000, issuedAt: now - 86_400_000, dueAt: now + 5 * 86_400_000, remitAccountId: accountId, status: "open" });
    return { vendorId, accountId, invoiceId };
  });
}

describe("screening: name matcher (pure)", () => {
  it("normalises case, punctuation, diacritics and legal suffixes", () => {
    expect(normalizeName("  Acme, Inc.  ")).toBe("acme");
    expect(normalizeName("ACME LLC")).toBe("acme");
    expect(normalizeName("Société Générale S.A.")).toBe("societe generale");
    expect(normalizeName("Müller GmbH & Co")).toBe("muller");
    expect(normalizeName("Example L.L.C.")).toBe("example");
    expect(normalizeName("Alder & Finch Legal")).toBe("alder finch legal");
    expect(normalizeName("Alder and Finch Legal")).toBe(normalizeName("Alder & Finch Legal"));
    // never reduces a name to nothing
    expect(normalizeName("Limited")).toBe("limited");
  });

  it("exact after normalisation scores 1 with method exact", () => {
    expect(scoreNames("Northwind Shell Holdings Ltd", "NORTHWIND SHELL HOLDINGS, LTD.")).toEqual({ score: 1, method: "exact" });
    expect(scoreNames("Ravenstone Logistics LLC", "Ravenstone Logistics Inc")).toEqual({ score: 1, method: "exact" });
  });

  it("token order does not matter (given/family name swap)", () => {
    const s = scoreNames("Volkov Dmitri Arkadievich", "Dmitri Arkadievich Volkov");
    expect(s.score).toBe(1);
    expect(s.method).toBe("token_sort");
    expect(tokenSortRatio("volkov dmitri", "dmitri volkov")).toBe(1);
  });

  it("jaroWinkler is the standard algorithm (known reference values)", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.8133, 3);
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "abc")).toBe(0);
  });

  it("a near-miss scores above the review threshold; an unrelated pair scores below 0.5", () => {
    const near = scoreNames("Granite Ridge Packaging", "Granite Ridge Packing Ltd");
    expect(near.score).toBeGreaterThanOrEqual(POTENTIAL_MATCH_THRESHOLD);
    expect(classify(near.score)).toBe("potential_match");
    const far = scoreNames("Lakeview Catering", "Zq Xu Wrb");
    expect(far.score).toBeLessThan(0.5);
    expect(classify(far.score)).toBe("clear");
  });

  it("classify never returns confirmed_match, even for a perfect score", () => {
    expect(classify(1)).toBe("potential_match");
    expect(classify(STRONG_MATCH_THRESHOLD)).toBe("potential_match");
    expect(classify(POTENTIAL_MATCH_THRESHOLD)).toBe("potential_match");
    expect(classify(POTENTIAL_MATCH_THRESHOLD - 0.0001)).toBe("clear");
    expect(classify(0)).toBe("clear");
  });
});

describe("screening: demo watchlist and OFAC CSV parser", () => {
  it("the demo list is synthetic, versioned and has unique ids", () => {
    expect(DEMO_LIST_VERSION).toBe("demo-2026-10");
    expect(DEMO_WATCHLIST.length).toBeGreaterThanOrEqual(25);
    expect(new Set(DEMO_WATCHLIST.map((e) => e.ent_num)).size).toBe(DEMO_WATCHLIST.length);
    for (const e of DEMO_WATCHLIST) expect(e.remarks.toLowerCase()).toContain("fictional");
    expect(watchlistNames().length).toBeGreaterThan(DEMO_WATCHLIST.length);
  });

  // Seeded vendor safety: the eval scenarios pay CleanCo and NorthPeak, so they (and every other seeded
  // vendor except the two deliberate demo near-misses) must screen clear against the demo list.
  const EXPECTED_DEMO_HITS = ["Harborline Freight", "Granite Ridge Packaging"];
  it("only the two chosen demo vendors score >= 0.85 against the list; CleanCo and NorthPeak are clear", () => {
    const vendors = (fixtureData as unknown as { vendors: { slug: string; name: string }[] }).vendors;
    expect(vendors.length).toBe(20);
    const hits: string[] = [];
    for (const vnd of vendors) {
      const r = screenName(vnd.name);
      if (r.status === "potential_match") hits.push(vnd.name);
    }
    expect(hits.sort()).toEqual([...EXPECTED_DEMO_HITS].sort());
    expect(screenName("CleanCo Facilities").status).toBe("clear");
    expect(screenName("NorthPeak Logistics").status).toBe("clear");
    for (const n of watchlistNames()) expect(scoreNames("CleanCo Facilities", n.name).score).toBeLessThan(POTENTIAL_MATCH_THRESHOLD);
  });

  it("screenName returns one sorted match per entry above reportAbove", () => {
    const r = screenName("Harborline Freight");
    expect(r.status).toBe("potential_match");
    expect(r.matches[0]).toMatchObject({ entry: "Harborline Freight Forwarders", program: "DEMO-SDGT" });
    expect(r.matches[0].score).toBeGreaterThanOrEqual(POTENTIAL_MATCH_THRESHOLD);
    for (let i = 1; i < r.matches.length; i++) expect(r.matches[i].score).toBeLessThanOrEqual(r.matches[i - 1].score);
    expect(new Set(r.matches.map((m) => m.entry)).size).toBe(r.matches.length);
    for (const m of r.matches) expect(m.score).toBeGreaterThanOrEqual(0.7);
    expect(screenName("Zq Xu Wrb Corporation").matches).toEqual([]);
  });

  const SDN_FIXTURE = [
    '36,"AEROCARIBBEAN AIRLINES","-0-","CUBA",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"-0-"',
    '173,"ANGLO-CARIBBEAN CO., LTD.","-0-","CUBA",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"-0-"',
    '7151,"BIN LADIN, Usama","individual","SDGT","-0-",-0-,-0-,-0-,-0-,-0-,-0-,"DOB 1957; alt. DOB 28 Jul 1957; POB Jeddah, Saudi Arabia; alt. POB Yemen."',
    '9876,"SABLE HORIZON","vessel","IRAN","-0-","9HA1234","Crude Oil Tanker","-0-","12345","Panama","Demo Shipping ""Ltd""","Vessel Registration Identification IMO 9999901."',
    '',
  ].join("\r\n");
  const ALT_FIXTURE = [
    '36,12,"aka","AERO-CARIBBEAN","-0-"',
    '7151,1,"aka","BIN LADEN, Osama","-0-"',
    '7151,2,"fka","Abu Abdallah","-0-"',
    '9876,3,"aka","SABLE HORIZON I",-0-',
  ].join("\n");

  it("parseSdnCsv handles the real SDN.CSV layout (-0- nulls, quoted commas, doubled quotes, CRLF)", () => {
    const rows = parseSdnCsv(SDN_FIXTURE);
    expect(rows.length).toBe(4);
    expect(rows[0]).toMatchObject({ ent_num: 36, name: "AEROCARIBBEAN AIRLINES", type: null, program: "CUBA", title: null, remarks: null });
    expect(rows[1].name).toBe("ANGLO-CARIBBEAN CO., LTD.");
    expect(rows[2]).toMatchObject({ ent_num: 7151, name: "BIN LADIN, Usama", type: "individual", program: "SDGT" });
    expect(rows[2].remarks).toContain("POB Jeddah");
    expect(rows[3]).toMatchObject({ ent_num: 9876, type: "vessel", remarks: "Vessel Registration Identification IMO 9999901." });
  });

  it("parseAltCsv and buildWatchlist join aliases onto entries", () => {
    const alts = parseAltCsv(ALT_FIXTURE);
    expect(alts.length).toBe(4);
    expect(alts[1]).toEqual({ ent_num: 7151, alt_num: 1, alt_type: "aka", alt_name: "BIN LADEN, Osama", alt_remarks: null });
    const list = buildWatchlist(parseSdnCsv(SDN_FIXTURE), alts);
    const ubl = list.find((e) => e.ent_num === 7151)!;
    expect(ubl.aliases).toEqual(["BIN LADEN, Osama", "Abu Abdallah"]);
    expect(list.find((e) => e.ent_num === 36)!.type).toBe("entity"); // -0- type defaults to entity
    // the parsed list plugs straight into the matcher
    const r = screenName("Osama Bin Laden", { list, listVersion: "sdn-fixture" });
    expect(r.status).toBe("potential_match");
    expect(r.matches[0].entry).toBe("BIN LADIN, Usama");
    expect(r.listVersion).toBe("sdn-fixture");
  });
});

describe("screening: Convex functions", () => {
  it("screenVendor records a clear result for a seeded vendor, appends an event, and is idempotent per list version", async () => {
    const { t, ids } = await setup();
    const cleanco = ids.vendors.cleanco as Id<"vendors">;
    const first = await t.mutation(api.screening.screen.screenVendor, { vendorId: cleanco });
    expect(first.status).toBe("clear");
    expect(first.inserted).toBe(true);
    const again = await t.mutation(api.screening.screen.screenVendor, { vendorId: cleanco });
    expect(again).toEqual({ screeningId: first.screeningId, status: "clear", inserted: false });
    const rows = await t.run(async (ctx) => ctx.db.query("screenings").collect());
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ vendorId: cleanco, subject: "CleanCo Facilities", listVersion: DEMO_LIST_VERSION, status: "clear" });
    expect(typeof rows[0].screenedAt).toBe("number");
    const ev = await t.run(async (ctx) => ctx.db.query("events").collect());
    const screened = ev.filter((e) => e.type === "vendor_screened");
    expect(screened.length).toBe(1);
    expect(screened[0].actor).toBe("system");
    expect(screened[0].payload).toMatchObject({ vendorName: "CleanCo Facilities", status: "clear", listVersion: DEMO_LIST_VERSION });
  });

  it("a near-miss vendor gets potential_match with the matching entry and program recorded", async () => {
    const { t } = await setup();
    const { vendorId } = await insertNearMissVendor(t);
    const r = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    expect(r.status).toBe("potential_match");
    const row = await t.run(async (ctx) => ctx.db.get(r.screeningId));
    expect(row!.matches[0]).toMatchObject({ entry: "Harborline Freight Forwarders", program: "DEMO-SDGT", method: "jaro_winkler" });
    expect(row!.matches[0].score).toBeGreaterThanOrEqual(POTENTIAL_MATCH_THRESHOLD);
    expect(row!.reviewedBy).toBeUndefined();
    const fv = await t.query(api.screening.screen.forVendor, { vendorId });
    expect(fv.latest!._id).toBe(r.screeningId);
    expect(fv.history.length).toBe(1);
    const pending = await t.query(api.screening.screen.pending, {});
    expect(pending.length).toBe(1);
    expect(pending[0]).toMatchObject({ vendorName: NEAR_MISS_NAME, status: "potential_match" });
  });

  it("screenAll screens every vendor and reports counts; summary reflects them", async () => {
    const { t } = await setup();
    await insertNearMissVendor(t);
    const before = await t.query(api.screening.screen.summary, {});
    expect(before).toMatchObject({ screenedVendors: 0, unscreened: 3, potentialMatches: 0 });
    const res = await t.mutation(api.screening.screen.screenAll, {});
    expect(res).toMatchObject({ screened: 3, potentialMatches: 1, listVersion: DEMO_LIST_VERSION });
    const after = await t.query(api.screening.screen.summary, {});
    expect(after).toMatchObject({ screenedVendors: 3, unscreened: 0, potentialMatches: 1, confirmed: 0, falsePositives: 0, listVersion: DEMO_LIST_VERSION });
    // second run: nothing new is inserted
    await t.mutation(api.screening.screen.screenAll, {});
    const rows = await t.run(async (ctx) => ctx.db.query("screenings").collect());
    expect(rows.length).toBe(3);
  });

  it("review: a clerk cannot review; an approver can mark false_positive with a note; the event names the operator", async () => {
    const { t } = await setup();
    const { clerk, approver } = await operators(t);
    const { vendorId } = await insertNearMissVendor(t);
    const { screeningId } = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    await expect(clerk.as.mutation(api.screening.screen.review, { screeningId, decision: "false_positive", note: "Different company" })).rejects.toThrow(/role_clerk/);
    // dismissing a hit needs a written reason
    await expect(approver.as.mutation(api.screening.screen.review, { screeningId, decision: "false_positive", note: "ok" })).rejects.toThrow(/note/);
    const d = await approver.as.mutation(api.screening.screen.review, { screeningId, decision: "false_positive", note: "Domestic freight broker; different legal entity and address" });
    expect(d).toBe("false_positive");
    const row = await t.run(async (ctx) => ctx.db.get(screeningId));
    expect(row).toMatchObject({ status: "false_positive", reviewedBy: approver.operatorId, note: "Domestic freight broker; different legal entity and address" });
    expect(typeof row!.reviewedAt).toBe("number");
    // cannot be reviewed twice
    await expect(approver.as.mutation(api.screening.screen.review, { screeningId, decision: "confirmed_match" })).rejects.toThrow(/already/);
    const ev = await t.run(async (ctx) => ctx.db.query("events").collect());
    const reviewed = ev.find((e) => e.type === "screening_reviewed")!;
    expect(reviewed.actor).toBe("human");
    expect(reviewed.payload).toMatchObject({ decision: "false_positive", reviewedBy: approver.operator.name, vendorName: NEAR_MISS_NAME });
    // the resolved row is not re-opened by re-screening against the same list
    const again = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    expect(again).toEqual({ screeningId, status: "false_positive", inserted: false });
    expect((await t.query(api.screening.screen.pending, {})).length).toBe(0);
    expect((await t.query(api.screening.screen.forVendor, { vendorId })).latest).toMatchObject({ reviewedByName: approver.operator.name });
  });

  it("review: an admin can confirm a match; a clear screening cannot be reviewed", async () => {
    const { t, ids } = await setup();
    const { admin } = await operators(t);
    const { vendorId } = await insertNearMissVendor(t);
    const { screeningId } = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    expect(await admin.as.mutation(api.screening.screen.review, { screeningId, decision: "confirmed_match" })).toBe("confirmed_match");
    expect((await t.query(api.screening.screen.summary, {})).confirmed).toBe(1);
    const clear = await t.mutation(api.screening.screen.screenVendor, { vendorId: ids.vendors.cleanco as Id<"vendors"> });
    await expect(admin.as.mutation(api.screening.screen.review, { screeningId: clear.screeningId, decision: "false_positive", note: "nothing to see" })).rejects.toThrow(/clear/);
  });

  it("policy blockOnScreeningHit: an unresolved potential match refuses payment; a clear vendor still pays; a false positive unblocks", async () => {
    const { t, ids } = await setup();
    const { admin, approver } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { blockOnScreeningHit: true } });
    const { vendorId, invoiceId } = await insertNearMissVendor(t);
    const { screeningId } = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    await t.mutation(api.screening.screen.screenVendor, { vendorId: ids.vendors.cleanco as Id<"vendors"> });

    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_screening_hit" });
    const ev = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(ev.some((e) => e.type === "payment_refused" && (e.payload as { reason: string }).reason === "policy_screening_hit")).toBe(true);
    expect((await t.run(async (ctx) => ctx.db.query("payments").collect())).length).toBe(0);

    // a vendor with a clear screening pays as before
    expect((await pay(t, ids.invoices["CC-2026-0412"] as Id<"invoices">)).ok).toBe(true);

    // a confirmed match stays blocked; a false positive releases the hold
    await approver.as.mutation(api.screening.screen.review, { screeningId, decision: "false_positive", note: "Reviewed registration documents; unrelated domestic entity" });
    expect((await pay(t, invoiceId)).ok).toBe(true);
  });

  it("policy blockOnScreeningHit: a confirmed match keeps the payment blocked", async () => {
    const { t } = await setup();
    const { admin } = await operators(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { blockOnScreeningHit: true } });
    const { vendorId, invoiceId } = await insertNearMissVendor(t);
    const { screeningId } = await t.mutation(api.screening.screen.screenVendor, { vendorId });
    await admin.as.mutation(api.screening.screen.review, { screeningId, decision: "confirmed_match", note: "Matches listed party" });
    expect(await pay(t, invoiceId)).toEqual({ ok: false, reason: "policy_screening_hit" });
  });

  it("onboarding: createVendor screens the new vendor automatically", async () => {
    const { t } = await setup();
    const ob = await asUser(t, "clerk");
    const clearId = await ob.as.mutation(api.onboarding.createVendor, { name: "Juniper Creative Studio", domain: "junipercreative.example" });
    expect((await t.query(api.screening.screen.forVendor, { vendorId: clearId })).latest).toMatchObject({ status: "clear", subject: "Juniper Creative Studio" });
    const hitId = await ob.as.mutation(api.onboarding.createVendor, { name: "Granite Ridge Packaging", domain: "graniteridge.example" });
    const fv = await t.query(api.screening.screen.forVendor, { vendorId: hitId });
    expect(fv.latest).toMatchObject({ status: "potential_match" });
    expect(fv.latest!.matches[0].entry).toBe("Granite Ridge Packaging Intl");
    expect((await t.query(api.screening.screen.pending, {})).map((p) => p.vendorName)).toEqual(["Granite Ridge Packaging"]);
  });
});
