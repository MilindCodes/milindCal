"use client";

import { motion } from "framer-motion";

interface BrandMarkProps {
  compact?: boolean;
  showTagline?: boolean;
  layoutId?: string;
}

export function BrandMark({ compact = false, showTagline = false, layoutId }: BrandMarkProps) {
  return (
    <motion.div layoutId={layoutId} className={`brand-mark ${compact ? "compact" : ""}`}>
      <svg aria-hidden="true" className="brand-glyph" viewBox="0 0 120 90">
        <rect fill="#ef4444" height="54" width="54" x="10" y="8" />
        <circle cx="55" cy="42" fill="#3b82f6" r="28" />
        <polygon fill="#facc15" points="112,64 34,64 74,4" />
      </svg>

      <div className="brand-copy">
        <p className="brand-wordmark">milind<span style={{ color: "var(--cherry)" }}>Cal</span></p>
        {showTagline ? <p className="brand-tagline">Own your hours. Move with intent.</p> : null}
      </div>
    </motion.div>
  );
}
