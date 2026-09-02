import type { MetadataRoute } from "next";

/** Web app manifest — makes milindCal installable and gives it a standalone
 *  window (no browser chrome) when launched from the dock or home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "milindCal",
    short_name: "milindCal",
    description: "Fluid Google-synced personal scheduling",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#fbf3ee",
    theme_color: "#fbf3ee",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        // "any" alone would let Android crop the glyph into a circle mask;
        // the SVG already carries its own rounded plate, so declare both.
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
