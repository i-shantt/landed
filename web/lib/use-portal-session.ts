"use client";
import { useSyncExternalStore } from "react";
import { getPortalSession } from "@/lib/portal-session";

const listeners = new Set<() => void>();
export function notifyPortalSession() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
/** Cookie-backed session token; `undefined` during SSR, null when signed out. */
export function usePortalSession(): string | null | undefined {
  return useSyncExternalStore(subscribe, () => getPortalSession(), () => undefined);
}
