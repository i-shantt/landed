"use client";
// Polling hooks over the portal route handlers. The session cookie is httpOnly, so "signed in"
// is inferred from the server's answer, never from reading the cookie.
import { useCallback, useEffect, useState } from "react";
import { portalRequests, portalToken, type PortalError, type PortalRequests, type PortalTokenInfo } from "@/lib/portal-session";

type State<T> = { loading: boolean; data: T | null; error: PortalError | null; signedIn: boolean | undefined };

function usePolled<T>(fetcher: () => Promise<{ status: number; data: T | null; error: PortalError | null }>, intervalMs: number) {
  const [state, setState] = useState<State<T>>({ loading: true, data: null, error: null, signedIn: undefined });
  const refresh = useCallback(async () => {
    const r = await fetcher();
    setState({ loading: false, data: r.data, error: r.error, signedIn: r.status !== 401 });
  }, [fetcher]);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => { if (!cancelled) await refresh(); };
    void tick();
    const id = intervalMs > 0 ? setInterval(tick, intervalMs) : undefined;
    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [refresh, intervalMs]);
  return { ...state, refresh };
}

/** Open confirmation requests for the signed-in vendor; polls every 5 s. */
export function usePortalRequests() {
  const fetcher = useCallback(() => portalRequests(), []);
  return usePolled<PortalRequests>(fetcher, 5000);
}

/** One confirmation token's status; polls every 5 s so a verification shows up without a refresh. */
export function usePortalToken(token: string) {
  const fetcher = useCallback(() => portalToken(token), [token]);
  return usePolled<PortalTokenInfo>(fetcher, 5000);
}
