import type { Metadata } from "next";
import "@/app/globals.css";
import { CursorTrail } from "@/components/cursor-trail";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "milindCal",
  description: "milindCal: fluid Google-synced personal scheduling",
  applicationName: "milindCal"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <CursorTrail />
      </body>
    </html>
  );
}
