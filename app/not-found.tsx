import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export default function NotFound() {
  return (
    <main className="signin-page" id="main-content" tabIndex={-1}>
      <section className="signin-card">
        <BrandMark showTagline />
        <p className="eyebrow">404</p>
        <h1>This page slipped off the calendar</h1>
        <p>
          The link you followed doesn&apos;t point anywhere in milindCal. It may have been
          renamed, or it never existed.
        </p>
        <Link className="primary-button" href="/">
          Back to your calendar
        </Link>
      </section>
    </main>
  );
}
