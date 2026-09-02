"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * app/error.tsx can't help because the layout that would host it is the thing
 * that failed. This replaces <html>, so it carries its own minimal markup and
 * inline styling — globals.css may not have loaded at this point.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[milindCal] root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fbf3ee",
          color: "#2a1418",
          fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "30rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>
            milindCal couldn&apos;t start
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#5b3a40", lineHeight: 1.5 }}>
            Something failed before the app could load. Your calendar data is
            untouched.
          </p>
          <button
            onClick={reset}
            type="button"
            style={{
              padding: "0.6rem 1.1rem",
              borderRadius: "6px",
              border: "none",
              background: "#b42a3a",
              color: "#fff",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Reload milindCal
          </button>
        </main>
      </body>
    </html>
  );
}
