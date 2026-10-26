// SYNTHETIC DEMO WATCHLIST. Every entry below is fictional; none corresponds to a real sanctioned
// party. The shape mirrors OFAC's SDN.CSV + ALT.CSV so the screening code, the storage format and the
// review workflow are identical to what a production deployment runs against the real list.
//
// Production: download the real files (follow the 302 redirect to the signed S3 URL) and feed them to
// `parseSdnCsv` / `parseAltCsv` below, then set `listVersion` to the published SHA-256 of SDN.CSV so a
// list refresh re-screens the vendor master (screen.ts dedupes on listVersion).
//   SDN list page:      https://sanctionslist.ofac.treas.gov/Home/SdnList
//   Consolidated page:  https://sanctionslist.ofac.treas.gov/Home/ConsolidatedList
//   Exports base URL:   https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/
//     SDN.CSV, ALT.CSV, ADD.CSV, SDN_COMMENTS.CSV  (and CONS_PRIM.CSV / CONS_ALT.CSV for non-SDN lists)
//   Column spec (DAT_SPEC.TXT): SDN.CSV = ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign,
//     Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks; ALT.CSV = ent_num, alt_num, alt_type,
//     alt_name, alt_remarks. Null fields are the literal string "-0-".

export const DEMO_LIST_VERSION = "demo-2026-10";

export type WatchlistType = "individual" | "entity" | "vessel";

export type WatchlistEntry = {
  /** Stable identifier, as OFAC's `ent_num`. */
  ent_num: number;
  name: string;
  type: WatchlistType;
  program: string;
  /** a.k.a. / f.k.a. names, screened with the same weight as the primary name. */
  aliases: string[];
  remarks: string;
};

export const DEMO_WATCHLIST: WatchlistEntry[] = [
  { ent_num: 90001, name: "Northwind Shell Holdings Ltd", type: "entity", program: "DEMO-SDGT", aliases: ["Northwind Shell Holdings", "NSH Holdings"], remarks: "Fictional. Front company pattern." },
  { ent_num: 90002, name: "Cobalt Meridian Trading SA", type: "entity", program: "DEMO-IRAN", aliases: ["Cobalt Meridian", "CM Trading SA"], remarks: "Fictional. Trading intermediary." },
  { ent_num: 90003, name: "Volkov Maritime Services", type: "entity", program: "DEMO-RUSSIA-EO14024", aliases: ["Volkov Marine Services OOO"], remarks: "Fictional. Ship management." },
  { ent_num: 90004, name: "Ravenstone Logistics LLC", type: "entity", program: "DEMO-SDNTK", aliases: ["Ravenstone Logistica"], remarks: "Fictional. Freight forwarder." },
  { ent_num: 90005, name: "Obsidian Peak Minerals Corp", type: "entity", program: "DEMO-DPRK", aliases: ["Obsidian Peak Mining"], remarks: "Fictional. Mineral exports." },
  { ent_num: 90006, name: "Saffron Gate Exchange House", type: "entity", program: "DEMO-SDGT", aliases: ["Saffron Gate Hawala"], remarks: "Fictional. Money services business." },
  { ent_num: 90007, name: "Tidewater Crescent Petrochem GmbH", type: "entity", program: "DEMO-IRAN", aliases: ["Tidewater Crescent"], remarks: "Fictional. Petrochemical trading." },
  { ent_num: 90008, name: "Blackfen Aerospace Components plc", type: "entity", program: "DEMO-NPWMD", aliases: ["Blackfen Aero"], remarks: "Fictional. Dual-use components." },
  { ent_num: 90009, name: "Kestrel Dune Construction Co", type: "entity", program: "DEMO-SYRIA", aliases: ["Kestrel Dune Contracting"], remarks: "Fictional. Construction." },
  { ent_num: 90010, name: "Argent Lantern Finance Ltd", type: "entity", program: "DEMO-CYBER2", aliases: ["Argent Lantern Capital"], remarks: "Fictional. Virtual currency exchange." },
  { ent_num: 90011, name: "Halcyon Verde Agro Export SA", type: "entity", program: "DEMO-VENEZUELA", aliases: ["Halcyon Verde"], remarks: "Fictional. Agricultural exports." },
  { ent_num: 90012, name: "Pallid Sun Media Group", type: "entity", program: "DEMO-ELECTION-EO13848", aliases: ["Pallid Sun Media"], remarks: "Fictional. Influence operations." },
  { ent_num: 90013, name: "Umbra Tessera Technologies", type: "entity", program: "DEMO-CYBER2", aliases: ["Umbra Tessera Tech"], remarks: "Fictional. Offensive cyber tooling." },
  { ent_num: 90014, name: "Greyhaven Charter Air", type: "entity", program: "DEMO-RUSSIA-EO14024", aliases: ["Greyhaven Air Charter"], remarks: "Fictional. Aircraft operator." },
  { ent_num: 90015, name: "Dmitri Arkadievich Volkov", type: "individual", program: "DEMO-RUSSIA-EO14024", aliases: ["Volkov, Dmitri", "Dmitriy Volkov"], remarks: "Fictional individual. DOB 1968." },
  { ent_num: 90016, name: "Farid Nasser Haddadi", type: "individual", program: "DEMO-IRAN", aliases: ["Haddadi, Farid", "Farid Hadadi"], remarks: "Fictional individual. DOB 1975." },
  { ent_num: 90017, name: "Marisela Ortega Quintanilla", type: "individual", program: "DEMO-SDNTK", aliases: ["Ortega Quintanilla, Marisela"], remarks: "Fictional individual. DOB 1981." },
  { ent_num: 90018, name: "Theodore Bramwell Oakes", type: "individual", program: "DEMO-CYBER2", aliases: ["Teddy Oakes", "Oakes, Theodore"], remarks: "Fictional individual. DOB 1990." },
  { ent_num: 90019, name: "Kwame Adjei Boateng", type: "individual", program: "DEMO-GLOMAG", aliases: ["Boateng, Kwame"], remarks: "Fictional individual. DOB 1962." },
  { ent_num: 90020, name: "Ling Wei Zhao", type: "individual", program: "DEMO-DPRK", aliases: ["Zhao Lingwei", "Zhao, Ling Wei"], remarks: "Fictional individual. DOB 1979." },
  { ent_num: 90021, name: "Sable Horizon", type: "vessel", program: "DEMO-IRAN", aliases: ["Sable Horizon I"], remarks: "Fictional vessel. Crude Oil Tanker. IMO 9999901." },
  { ent_num: 90022, name: "Amber Wake", type: "vessel", program: "DEMO-DPRK", aliases: ["Amber Wake 7"], remarks: "Fictional vessel. General Cargo. IMO 9999902." },
  { ent_num: 90023, name: "Nightjar Star", type: "vessel", program: "DEMO-RUSSIA-EO14024", aliases: ["Night Jar Star"], remarks: "Fictional vessel. LNG Carrier. IMO 9999903." },
  { ent_num: 90024, name: "Ferrum Aurora Metals Trading", type: "entity", program: "DEMO-RUSSIA-EO14024", aliases: ["Ferrum Aurora"], remarks: "Fictional. Metals trading." },
  { ent_num: 90025, name: "Quillon Bridge Consultancy LLP", type: "entity", program: "DEMO-GLOMAG", aliases: ["Quillon Bridge"], remarks: "Fictional. Procurement agent." },
  // Two deliberate near-misses of seeded demo vendors so the screening page shows the review flow.
  // Chosen so the seeded vendor "CleanCo Facilities" (paid by the eval scenarios) stays below threshold.
  { ent_num: 90026, name: "Harborline Freight Forwarders", type: "entity", program: "DEMO-SDGT", aliases: ["Harborline Freight Fwd"], remarks: "Fictional. Near-miss of demo vendor Harborline Freight." },
  { ent_num: 90027, name: "Granite Ridge Packaging Intl", type: "entity", program: "DEMO-IRAN", aliases: ["Granite Ridge Packing"], remarks: "Fictional. Near-miss of demo vendor Granite Ridge Packaging." },
];

/** Every screenable name on the list: primary name plus aliases, each tagged with its entry. */
export function watchlistNames(list: WatchlistEntry[] = DEMO_WATCHLIST): { entry: WatchlistEntry; name: string; alias: boolean }[] {
  const out: { entry: WatchlistEntry; name: string; alias: boolean }[] = [];
  for (const e of list) {
    out.push({ entry: e, name: e.name, alias: false });
    for (const a of e.aliases) out.push({ entry: e, name: a, alias: true });
  }
  return out;
}

// ---- OFAC CSV parsing (real-list loader) ----

const NULL = "-0-";

/** RFC-4180-ish CSV: handles quoted fields with embedded commas and doubled quotes; CRLF or LF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const nul = (s: string | undefined) => (s === undefined || s.trim() === NULL ? null : s.trim());

export type SdnRow = { ent_num: number; name: string; type: WatchlistType | "aircraft" | null; program: string | null; title: string | null; remarks: string | null };
export type AltRow = { ent_num: number; alt_num: number; alt_type: string | null; alt_name: string; alt_remarks: string | null };

/** SDN.CSV (no header row): ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks. */
export function parseSdnCsv(csvText: string): SdnRow[] {
  const out: SdnRow[] = [];
  for (const r of parseCsvRows(csvText)) {
    const ent_num = Number(r[0]);
    const name = nul(r[1]);
    if (!Number.isFinite(ent_num) || !name) continue;
    const t = nul(r[2]);
    const type = t === "individual" || t === "entity" || t === "vessel" || t === "aircraft" ? t : null;
    out.push({ ent_num, name, type, program: nul(r[3]), title: nul(r[4]), remarks: nul(r[11]) });
  }
  return out;
}

/** ALT.CSV (no header row): ent_num, alt_num, alt_type, alt_name, alt_remarks. */
export function parseAltCsv(csvText: string): AltRow[] {
  const out: AltRow[] = [];
  for (const r of parseCsvRows(csvText)) {
    const ent_num = Number(r[0]);
    const alt_num = Number(r[1]);
    const alt_name = nul(r[3]);
    if (!Number.isFinite(ent_num) || !Number.isFinite(alt_num) || !alt_name) continue;
    out.push({ ent_num, alt_num, alt_type: nul(r[2]), alt_name, alt_remarks: nul(r[4]) });
  }
  return out;
}

/** Join parsed SDN + ALT rows into the in-memory watchlist shape used by the matcher. */
export function buildWatchlist(sdn: SdnRow[], alt: AltRow[]): WatchlistEntry[] {
  const aliases = new Map<number, string[]>();
  for (const a of alt) aliases.set(a.ent_num, [...(aliases.get(a.ent_num) ?? []), a.alt_name]);
  return sdn
    .filter((s) => s.type !== "aircraft")
    .map((s) => ({
      ent_num: s.ent_num,
      name: s.name,
      type: (s.type ?? "entity") as WatchlistType,
      program: s.program ?? "UNKNOWN",
      aliases: aliases.get(s.ent_num) ?? [],
      remarks: s.remarks ?? "",
    }));
}
