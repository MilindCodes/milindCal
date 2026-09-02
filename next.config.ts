import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Strip console.* (except warnings/errors) from production bundles.
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false
  },
  experimental: {
    // Rewrite barrel imports (`import { X } from "lucide-react"`) into direct
    // per-module imports so the bundler only pulls the icons/helpers actually
    // referenced. lucide-react in particular re-exports ~1,500 components from
    // its index, and every one of them was reachable from the initial chunk.
    optimizePackageImports: ["lucide-react", "date-fns"]
  }
};

export default nextConfig;
