import { BrandMark } from "@/components/brand-mark";

/**
 * Shown while the server resolves the session on `/`. Previously that await
 * produced a blank white document — no branding, no signal — for the whole
 * round-trip.
 */
export default function Loading() {
  return (
    <main className="signin-page" aria-busy="true">
      <section className="signin-card signin-card--loading">
        <BrandMark showTagline />
        <p className="loading-line" role="status">
          Opening your calendar…
        </p>
      </section>
    </main>
  );
}
