// Where the production sanctions list comes from, and the pure pieces of loading it: the two fixed
// OFAC export URLs (the only hosts the loader ever calls), the size cap, the SHA-256 that versions a
// list, and the parse of SDN.CSV + ALT.CSV into the matcher's shape. No Convex functions here, so the
// Node action (watchlistFetch.ts), the isolate functions (watchlistStore.ts) and the tests share it.
import { ConvexError } from "convex/values";
import { parseSdnCsv, parseAltCsv, buildWatchlist, type WatchlistEntry } from "./watchlist";

export const OFAC_EXPORTS = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
export const SDN_URL = `${OFAC_EXPORTS}SDN.CSV`;
export const ALT_URL = `${OFAC_EXPORTS}ALT.CSV`;
export const MAX_BYTES = 64 * 1024 * 1024;
export const REFRESH_EVERY_MS = 24 * 3600_000;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One export: fixed URL, follows the Treasury's redirect to the signed object, refuses anything over MAX_BYTES or empty. */
export async function fetchExport(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow", headers: { accept: "text/csv, text/plain;q=0.9, */*;q=0.1" } });
  if (!res.ok) throw new ConvexError(`watchlist_fetch_failed:${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new ConvexError("watchlist_too_large");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new ConvexError("watchlist_too_large");
  if (buf.byteLength === 0) throw new ConvexError("watchlist_empty");
  return new TextDecoder("utf-8").decode(buf);
}

/** Pure: the two exports in the matcher's shape. Throws when nothing parses (an error page, a captcha, an empty file). */
export function parseExports(sdnText: string, altText: string): { list: WatchlistEntry[]; names: number } {
  const list = buildWatchlist(parseSdnCsv(sdnText), parseAltCsv(altText));
  if (list.length === 0) throw new ConvexError("watchlist_parse_empty");
  return { list, names: list.reduce((n, e) => n + 1 + e.aliases.length, 0) };
}
