"use client";
// Route-segment error boundary. Wraps every page under the root layout, so the
// workspace shell (sidebar, top bar, clock) stays mounted around the fallback.
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/landed/primitives";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const digest = (error as { digest?: string } | null)?.digest;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Something went wrong"
        description="This page hit an error while rendering. Nothing was paid or changed by the error itself; the database is the source of truth."
        actions={
          <>
            <Button size="sm" onClick={() => retry()}>
              Try again
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/cases" />}
            >
              Back to cases
            </Button>
          </>
        }
      />
      {(message || digest) && (
        <pre className="overflow-x-auto rounded-md border bg-card px-4 py-3 font-mono text-xs text-slate-700 whitespace-pre-wrap">
          {message}
          {digest ? `\n(digest ${digest})` : ""}
        </pre>
      )}
      <p className="text-sm text-muted-foreground">
        If this keeps happening, open{" "}
        <Link href="/health" className="underline underline-offset-2">
          System health
        </Link>{" "}
        to check the deployment and the clock.
      </p>
    </div>
  );
}
