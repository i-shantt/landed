// Which sanctions list is in force. `watchlist:current` (settings) points at the loaded OFAC list in
// file storage; when it is absent the synthetic demo list in watchlist.ts applies. Kept apart from
// screen.ts and watchlistStore.ts so the policy engine and the mutations can read it without importing
// the action module.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getSetting } from "../settings";

export const CURRENT_KEY = "watchlist:current";
export const NEXT_RUN_KEY = "watchlist:nextRun";
export const RESCREEN_KEY = "watchlist:rescreenScheduled";
export const LAST_ERROR_KEY = "watchlist:lastError";

export type LoadedWatchlist = {
  storageId: Id<"_storage">;
  /** SHA-256 of SDN.CSV as published; a new hash is a new list and re-screens the vendor master. */
  version: string;
  entries: number;
  /** Primary names plus aliases, the number of strings a vendor name is compared against. */
  names: number;
  bytes: number;
  loadedAt: number;
  source: string;
};

export async function loadedWatchlist(ctx: QueryCtx | MutationCtx): Promise<LoadedWatchlist | null> {
  const raw = await getSetting(ctx, CURRENT_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<LoadedWatchlist>;
    return typeof p.version === "string" && typeof p.storageId === "string" && typeof p.entries === "number" ? (p as LoadedWatchlist) : null;
  } catch {
    return null;
  }
}
