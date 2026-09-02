import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "@/app/globals.css";
import { CursorTrail } from "@/components/cursor-trail";
import { Providers } from "@/components/providers";

/* Self-hosted via next/font: the previous `@import url(fonts.googleapis.com)`
 * at the top of globals.css was render-blocking and serial — the browser had
 * to download the stylesheet, parse it, then open a second connection to
 * fonts.gstatic.com before any text could paint. next/font inlines the
 * @font-face rules, preloads the woff2 from our own origin, and applies
 * `size-adjust` fallback metrics so there's no layout shift when they land. */
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-display-loaded",
  fallback: ["Times New Roman", "serif"],
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-ui-loaded",
  fallback: ["-apple-system", "BlinkMacSystemFont", "sans-serif"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono-loaded",
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: {
    default: "milindCal",
    template: "%s · milindCal",
  },
  description: "milindCal: fluid Google-synced personal scheduling",
  applicationName: "milindCal",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "milindCal",
    statusBarStyle: "default",
  },
  formatDetection: {
    // Stop iOS Safari from auto-linking event times and locations as
    // phone numbers / addresses inside calendar tiles.
    telephone: false,
    date: false,
    address: false,
  },
  // Personal calendar — nothing here should ever reach an index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The workspace is a fixed, app-like shell; letting it zoom-pan on mobile
  // makes the calendar grid drift out of the viewport.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#2a1418" },
  ],
  colorScheme: "light",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <div className="paper-bg" aria-hidden="true" />
        <div className="orbs" aria-hidden="true">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
        <Providers>{children}</Providers>
        <CursorTrail />
      </body>
    </html>
  );
}
