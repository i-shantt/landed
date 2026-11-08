// Loading the real OFAC list: fetch from the two fixed URLs, version by sha256(SDN.CSV), store once,
// re-screen the vendor master, fail closed in policy until a vendor has been screened against it.
// The network is stubbed; the fixture mirrors the real column layout (-0- nulls, quoted commas, CRLF).
import { describe, it, expect, vi, afterEach } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup, drain, pay, actors } from "./harness";
import { SDN_URL, ALT_URL, sha256Hex, parseExports, MAX_BYTES } from "../convex/screening/watchlistSource";
import { CURRENT_KEY, RESCREEN_KEY } from "../convex/screening/listState";
import { setSetting } from "../convex/settings";

type T = Awaited<ReturnType<typeof setup>>["t"];

// SDN.CSV: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
const SDN_ROWS = [
  `10001,"HARBORLINE FREIGHT FORWARDING LTD","-0-","SDGT",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"Fixture. Near-miss of the test vendor."`,
  `10002,"COBALT MERIDIAN TRADING SA","-0-","IRAN",-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-`,
  `10003,"VOLKOV, Dmitri","individual","RUSSIA-EO14024","Director",-0-,-0-,-0-,-0-,-0-,-0-,"DOB 01 Jan 1968"`,
  `10004,"SABLE HORIZON","vessel","IRAN",-0-,"ABCD","Crude Oil Tanker",-0-,-0-,"None Identified","Fixture Shipping","IMO 9999901"`,
  `10005,"FIXTURE AIRCRAFT","aircraft","SDGT",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"Dropped by buildWatchlist"`,
  `10006,"RAVENSTONE LOGISTICS, LLC","-0-","SDNTK",-0-,-0-,-0-,-0-,-0-,-0-,-0-,"Quoted comma ""in"" the name"`,
];
const SDN = SDN_ROWS.join("\r\n") + "\r\n";
// ALT.CSV: ent_num, alt_num, alt_type, alt_name, alt_remarks
const ALT = `10002,1,"aka","CM TRADING",-0-\r\n10003,2,"aka","Dmitriy Volkov",-0-\r\n`;
const ENTRIES = 5; // the aircraft is dropped
const NAMES = ENTRIES + 2;

function stubOfac(opts: { sdn?: string; alt?: string; status?: number; headers?: Record<string, string> } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    const body = String(url).endsWith("SDN.CSV") ? (opts.sdn ?? SDN) : (opts.alt ?? ALT);
    return new Response(body, { status: opts.status ?? 200, headers: { "content-type": "text/csv", ...(opts.headers ?? {}) } });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

async function insertVendor(t: T, name: string, slug: string) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const vendorId = await ctx.db.insert("vendors", { name, domain: `${slug}.example`, slug, onboardedAt: now - 100 * 86_400_000, hasPortalLogin: false });
    const accountHash = `testhash-${slug}-0001`;
    const accountId = await ctx.db.insert("bankAccounts", { vendorId, identityKey: `${vendorId}:${accountHash}`, version: 1, routing: "021000021", accountLast4: "4321", accountHash, accountCiphertext: "test-ciphertext", status: "verified", firstPaidAt: now - 50 * 86_400_000, createdVia: "seed" });
    const invoiceId = await ctx.db.insert("invoices", { vendorId, number: `${slug.toUpperCase()}-1001`, amountCents: 125_000, issuedAt: now - 86_400_000, dueAt: now + 5 * 86_400_000, remitAccountId: accountId, status: "open" });
    return { vendorId, invoiceId };
  });
}
const refresh = (t: T) => t.action(internal.screening.watchlistFetch.refresh, { reschedule: false });
const screenings = (t: T) => t.run(async (ctx) => ctx.db.query("screenings").collect());
const events = (t: T, type: string) => t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((e) => e.type === type));
const latestOf = async (t: T, vendorId: Id<"vendors">) => {
  const rows = (await screenings(t)).filter((s) => s.vendorId === vendorId).sort((a, b) => b.screenedAt - a.screenedAt || b._creationTime - a._creationTime);
  return rows[0] ?? null;
};

describe("watchlist loader: pure pieces", () => {
  it("sha256Hex is SHA-256 (known vector) and parseExports joins SDN + ALT, drops aircraft and refuses an empty parse", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const { list, names } = parseExports(SDN, ALT);
    expect(list.map((e) => e.ent_num)).toEqual([10001, 10002, 10003, 10004, 10006]);
    expect(names).toBe(NAMES);
    expect(list.find((e) => e.ent_num === 10006)?.name).toBe('RAVENSTONE LOGISTICS, LLC');
    expect(list.find((e) => e.ent_num === 10003)).toMatchObject({ type: "individual", aliases: ["Dmitriy Volkov"], program: "RUSSIA-EO14024" });
    expect(() => parseExports("<html><body>Access denied</body></html>", "")).toThrow(/watchlist_parse_empty/);
    expect(MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe("watchlist loader: refresh", () => {
  it("fetches the two fixed OFAC URLs, versions the list by sha256(SDN.CSV), stores it once, points settings at it and re-screens every vendor", async () => {
    const { t, ids } = await setup();
    const { admin } = await actors(t);
    const { vendorId: harborline } = await insertVendor(t, "Harborline Freight", "harborline");
    const calls = stubOfac();
    const r = await refresh(t);
    expect(new Set(calls)).toEqual(new Set([SDN_URL, ALT_URL]));
    expect(r.version).toBe(await sha256Hex(SDN));
    expect(r).toMatchObject({ changed: true, entries: ENTRIES, nextRunAt: null });
    const vendors = await t.run(async (ctx) => ctx.db.query("vendors").collect());
    expect(r.screened).toBe(vendors.length);
    expect(r.potentialMatches).toBe(1);

    const status = await admin.as.query(api.screening.watchlistStore.status, {});
    expect(status.loaded).toMatchObject({ version: r.version, entries: ENTRIES, names: NAMES, source: "ofac" });
    expect(status.nextRunAt).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.sources).toEqual([SDN_URL, ALT_URL]);
    const blob = await t.run(async (ctx) => ctx.db.system.get(status.loaded!.storageId));
    expect(blob).not.toBeNull();
    expect(blob!.size).toBeGreaterThan(100);

    // every vendor has a row at the new version; the near-miss is a potential match, CleanCo is clear
    for (const vnd of vendors) expect((await latestOf(t, vnd._id))?.listVersion).toBe(r.version);
    const hl = await latestOf(t, harborline);
    expect(hl).toMatchObject({ status: "potential_match", subject: "Harborline Freight" });
    expect(hl!.matches[0]).toMatchObject({ entry: "HARBORLINE FREIGHT FORWARDING LTD", program: "SDGT" });
    expect((await latestOf(t, ids.vendors.cleanco as Id<"vendors">))?.status).toBe("clear");
    expect((await events(t, "watchlist_loaded")).map((e) => e.payload)).toEqual([expect.objectContaining({ version: r.version, previousVersion: null, entries: ENTRIES, names: NAMES, source: "ofac" })]);
    expect((await events(t, "vendor_screened")).length).toBe(vendors.length);

    // the summary and the vendor panel report the loaded list
    const summary = await admin.as.query(api.screening.screen.summary, {});
    expect(summary).toMatchObject({ loaded: true, listVersion: r.version, listSize: ENTRIES, stale: 0, potentialMatches: 1 });

    // same list again: nothing stored, nothing re-screened, one loaded event still
    const before = (await screenings(t)).length;
    const again = await refresh(t);
    expect(again).toMatchObject({ version: r.version, changed: false, screened: 0 });
    expect((await screenings(t)).length).toBe(before);
    expect((await events(t, "watchlist_loaded")).length).toBe(1);

    // a changed list: new version, old blob gone, every vendor screened again at the new version
    const changedSdn = SDN + `10007,"NEW FIXTURE ENTITY","-0-","CYBER2",-0-,-0-,-0-,-0-,-0-,-0-,-0-,-0-\r\n`;
    stubOfac({ sdn: changedSdn });
    const third = await refresh(t);
    expect(third.changed).toBe(true);
    expect(third.version).not.toBe(r.version);
    expect(third.entries).toBe(ENTRIES + 1);
    expect(third.screened).toBe(vendors.length);
    expect((await screenings(t)).length).toBe(before + vendors.length);
    expect(await t.run(async (ctx) => ctx.db.system.get(status.loaded!.storageId))).toBeNull();
    const after = await admin.as.query(api.screening.watchlistStore.status, {});
    expect(after.loaded).toMatchObject({ version: third.version, entries: ENTRIES + 1 });
    expect((await events(t, "watchlist_loaded")).at(-1)?.payload).toMatchObject({ previousVersion: r.version });
  });

  it("a failed or oversized or unparseable download is recorded and leaves the current list untouched", async () => {
    const { t } = await setup();
    const { admin } = await actors(t);
    stubOfac();
    const good = await refresh(t);

    stubOfac({ status: 503 });
    await expect(refresh(t)).rejects.toThrow(/watchlist_fetch_failed:503/);
    stubOfac({ headers: { "content-length": String(MAX_BYTES + 1) } });
    await expect(refresh(t)).rejects.toThrow(/watchlist_too_large/);
    stubOfac({ sdn: "<html>captcha</html>", alt: "" });
    await expect(refresh(t)).rejects.toThrow(/watchlist_parse_empty|watchlist_empty/);

    const status = await admin.as.query(api.screening.watchlistStore.status, {});
    expect(status.loaded?.version).toBe(good.version);
    expect(status.lastError?.error).toMatch(/watchlist_/);
    expect((await events(t, "watchlist_refresh_failed")).length).toBe(3);
    expect((await events(t, "watchlist_loaded")).length).toBe(1);

    // a later good download clears the error
    stubOfac();
    await refresh(t);
    expect((await admin.as.query(api.screening.watchlistStore.status, {})).lastError).toBeNull();
  });
});

describe("watchlist loader: screening against a loaded list", () => {
  it("onboarding schedules one debounced rescreen; the vendor is screened against the loaded version after the action runs; screenVendor then returns the row without scheduling", async () => {
    const { t } = await setup();
    const { clerk } = await actors(t);
    stubOfac();
    const { version } = await refresh(t);

    const a = await clerk.as.mutation(api.onboarding.createVendor, { name: "Fixture Supplies Co", domain: "fixturesupplies.example" });
    const b = await clerk.as.mutation(api.onboarding.createVendor, { name: "Cobalt Meridian", domain: "cobaltmeridian.example" });
    // nothing recorded yet, one rescreen booked (flag set once for the two vendors)
    expect(await latestOf(t, a)).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", RESCREEN_KEY)).unique()) !== null)).toBe(true);
    const pendingResult = await clerk.as.mutation(api.screening.screen.screenVendor, { vendorId: a });
    expect(pendingResult).toMatchObject({ screeningId: null, status: "pending", pending: true, inserted: false, listVersion: version });

    await drain(t);
    expect(await t.run(async (ctx) => ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", RESCREEN_KEY)).unique())).toBeNull();
    expect(await latestOf(t, a)).toMatchObject({ listVersion: version, status: "clear", subject: "Fixture Supplies Co" });
    expect(await latestOf(t, b)).toMatchObject({ listVersion: version, status: "potential_match" });

    const done = await clerk.as.mutation(api.screening.screen.screenVendor, { vendorId: a });
    expect(done).toMatchObject({ status: "clear", pending: false, inserted: false, listVersion: version });
    const all = await clerk.as.mutation(api.screening.screen.screenAll, {});
    expect(all).toMatchObject({ pending: 0, listVersion: version });
    expect(all.potentialMatches).toBeGreaterThanOrEqual(1);
  });

  it("policy blockOnScreeningHit fails closed while a vendor awaits screening against the loaded list, then pays once screened clear; a loaded-list hit still refuses", async () => {
    const { t, ids } = await setup();
    const { admin } = await actors(t);
    await admin.as.mutation(api.controls.policy.set, { patch: { blockOnScreeningHit: true } });
    const cc = ids.invoices["CC-2026-0412"] as Id<"invoices">;
    const { invoiceId: hlInvoice } = await insertVendor(t, "Harborline Freight", "harborline");

    // demo list in force and CleanCo never screened: pays (unchanged behaviour)
    const preview = await admin.as.query(api.paymentRun.preview, {});
    const line = preview.lines.find((l) => l.invoiceId === cc)!;
    expect(line.decision.ok).toBe(true);
    expect(line.policy === null || line.policy.ok).toBe(true);

    // a list is in force (pointer set) but CleanCo has not been screened against it: refused, nothing sent
    await t.run(async (ctx) => setSetting(ctx, CURRENT_KEY, JSON.stringify({ storageId: "kg000000000000000000000000000000", version: "v-not-yet-screened", entries: 1, names: 1, bytes: 1, loadedAt: 1, source: "test" })));
    const refused = await pay(t, cc);
    expect(refused).toEqual({ ok: false, reason: "policy_screening_pending" });
    expect((await admin.as.query(api.paymentRun.preview, {})).lines.find((l) => l.invoiceId === cc)?.policy).toMatchObject({ ok: false, reason: "policy_screening_pending" });
    expect((await events(t, "payment_refused")).some((e) => (e.payload as { reason: string }).reason === "policy_screening_pending")).toBe(true);
    expect((await t.run(async (ctx) => ctx.db.query("payments").collect())).length).toBe(0);

    // the real list arrives and every vendor is screened against it: CleanCo pays, the near-miss is a hit
    stubOfac();
    const { version } = await refresh(t);
    expect((await latestOf(t, ids.vendors.cleanco as Id<"vendors">))?.listVersion).toBe(version);
    expect((await pay(t, cc)).ok).toBe(true);
    expect(await pay(t, hlInvoice)).toEqual({ ok: false, reason: "policy_screening_hit" });
  });
});

describe("watchlist loader: access and reset", () => {
  it("refreshNow is admin-only and books a run; status needs a session; the policy off means no pending refusal", async () => {
    const { t } = await setup();
    const { clerk, admin } = await actors(t);
    await expect(t.action(api.screening.watchlistStore.refreshNow, {})).rejects.toThrow(/unauthenticated/);
    await expect(clerk.as.action(api.screening.watchlistStore.refreshNow, {})).rejects.toThrow(/role_clerk/);
    await expect(t.query(api.screening.watchlistStore.status, {})).rejects.toThrow(/unauthenticated/);
    const started = await admin.as.action(api.screening.watchlistStore.refreshNow, {});
    expect(started).toEqual({ started: true, chained: true });
    expect((await events(t, "watchlist_refresh_requested")).map((e) => e.payload)).toEqual([expect.objectContaining({ startsDailyRefresh: true })]);
    // a second request while the first is booked does not start a second daily chain
    const second = await admin.as.action(api.screening.watchlistStore.refreshNow, {});
    expect(second).toEqual({ started: true, chained: false });
    const status = await admin.as.query(api.screening.watchlistStore.status, {});
    expect(status.loaded).toBeNull();
    expect(status.demo).toMatchObject({ version: expect.stringMatching(/^demo-/), entries: expect.any(Number) });
    expect(typeof status.nextRunAt === "number" || status.nextRunAt === null).toBe(true);
  });

  it("a demo reset wipes screenings with the demo data but keeps the loaded list pointer", async () => {
    const { t } = await setup();
    stubOfac();
    const { version } = await refresh(t);
    expect((await screenings(t)).length).toBeGreaterThan(0);
    await t.mutation(internal.seed.reset, {});
    expect((await screenings(t)).length).toBe(0);
    const kept = await t.run(async (ctx) => ctx.db.query("settings").collect());
    expect(kept.map((s) => s.key).sort()).toEqual([CURRENT_KEY]);
    expect(JSON.parse(kept[0].value).version).toBe(version);
  });
});
