"use client";
// Replaces the root layout when the layout itself fails. Must render its own
// <html> and <body>; global styles are not applied here, so styles are inline.
import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const message = error instanceof Error ? error.message : "";
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#f7f8fa",
          color: "#263430",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <title>Landed: something went wrong</title>
        <main
          style={{
            maxWidth: 520,
            width: "100%",
            background: "#fff",
            border: "1px solid #e2e7e5",
            borderRadius: 7,
            padding: "24px 28px",
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 550,
              letterSpacing: "-0.6px",
              margin: 0,
            }}
          >
            Landed could not load
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5f6b66" }}>
            The application shell failed to render. Nothing was paid or changed
            by this error.
          </p>
          {message && (
            <pre
              style={{
                fontSize: 12,
                whiteSpace: "pre-wrap",
                background: "#f0f3f2",
                borderRadius: 5,
                padding: "8px 10px",
                color: "#374b3e",
              }}
            >
              {message}
            </pre>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                background: "#244d3e",
                color: "#fff",
                border: 0,
                borderRadius: 5,
                padding: "8px 12px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                border: "1px solid #dfe4e5",
                borderRadius: 5,
                padding: "8px 12px",
                fontSize: 13,
                color: "#263430",
                textDecoration: "none",
              }}
            >
              Go to the start page
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
