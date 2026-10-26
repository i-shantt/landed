"use client";
// Shows a small fixed banner once the Convex WebSocket has been down for ~3 s.
// Mounted in Providers so it is present on every page, including the portal.
import { useEffect, useState } from "react";
import { useConvexConnectionState } from "convex/react";
import { WifiOff } from "lucide-react";

const DELAY_MS = 3000;

export function ConnectionBanner() {
  const state = useConvexConnectionState();
  const connected = state.isWebSocketConnected;
  // The banner is armed for one specific outage: connectionCount changes on every reconnect,
  // so a later disconnect waits its own 3 s again, and reconnecting hides it without a setState.
  const [shownFor, setShownFor] = useState<number | null>(null);
  useEffect(() => {
    if (connected) return;
    const outage = state.connectionCount;
    const t = setTimeout(() => setShownFor(outage), DELAY_MS);
    return () => clearTimeout(t);
  }, [connected, state.connectionCount]);
  const show = !connected && shownFor === state.connectionCount;
  if (!show) return null;
  const never = !state.hasEverConnected;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"
    >
      <WifiOff className="size-3.5" aria-hidden />
      <span>
        {never ? "Connecting to the backend…" : "Reconnecting to the backend…"}
        {state.connectionRetries > 0 ? ` (attempt ${state.connectionRetries + 1})` : ""}
      </span>
    </div>
  );
}
