"use client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ReactNode, useMemo } from "react";
import { OperatorProvider } from "@/lib/operator";
import { ConnectionBanner } from "@/components/landed/ConnectionBanner";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

function ConfigError() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <div className="rounded-md border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900" role="alert">
        <h1 className="text-base font-semibold">Landed is not configured</h1>
        <p className="mt-1 leading-relaxed">
          <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code> is not set, so the app does not know which Convex
          deployment to talk to. Add it to <code className="font-mono">web/.env.local</code> (local dev: the URL printed by{" "}
          <code className="font-mono">npx convex dev</code>) and restart the dev server.
        </p>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => (CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null), []);
  if (!client) return <ConfigError />;
  return (
    <ConvexAuthNextjsProvider client={client}>
      <ConnectionBanner />
      <OperatorProvider>{children}</OperatorProvider>
    </ConvexAuthNextjsProvider>
  );
}
