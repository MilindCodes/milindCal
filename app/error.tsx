"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

/**
 * Route-level error boundary.
 *
 * Without this, any thrown render error inside the workspace produced Next's
 * bare "Application error: a client-side exception has occurred" screen with
 * no branding, no explanation and no way forward but a manual reload.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the browser console and, in production, wherever console
    // errors are collected. `digest` is the only handle on the server-side
    // stack, which Next redacts from the client.
    console.error("[milindCal] render error:", error);
  }, [error]);

  return (
    <main className="signin-page" id="main-content" tabIndex={-1}>
      <section className="signin-card">
        <BrandMark />
        <p className="eyebrow">Something broke</p>
        <h1>milindCal hit an unexpected error</h1>
        <p>
          Your calendar data is safe — this is a display problem, not a data one.
          Trying again usually clears it.
        </p>
        {error.digest ? (
          <p className="error-digest">
            Reference: <code>{error.digest}</code>
          </p>
        ) : null}
        <button className="primary-button" onClick={reset} type="button">
          <RefreshCw size={16} aria-hidden="true" />
          Try again
        </button>
      </section>
    </main>
  );
}
