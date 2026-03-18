"use client";

import { motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { DocsStickyPanel } from "@/components/docs-sticky-panel";
import { MilindDoc } from "@/components/milind-doc";
import type { PanelNote } from "@/lib/models";

interface MilindDocsSectionProps {
  onClose: () => void;
  onAddToCalendar: (title: string, description: string) => void;
  onAddToTodo: (title: string) => void;
  onSendNoteToCanvas: (note: PanelNote) => void;
  /** Forwarded to the drag handle so the parent can wire up Framer Motion drag */
  dragHandleMotionProps?: React.ComponentPropsWithoutRef<typeof motion.div>;
}

export function MilindDocsSection({
  onClose,
  onAddToCalendar,
  onAddToTodo,
  onSendNoteToCanvas,
  dragHandleMotionProps,
}: MilindDocsSectionProps) {
  return (
    <div className="milind-docs-section">
      {/* Drag-to-dismiss handle */}
      <motion.div
        className="docs-drag-zone"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.35}
        onDragEnd={(_, info) => {
          if (info.offset.y > 72) onClose();
        }}
        {...dragHandleMotionProps}
      >
        <div className="docs-drag-pill" />
        <button className="docs-back-btn" onClick={onClose} type="button">
          <ArrowUp size={13} /> Back to calendar
        </button>
        <span className="docs-section-brand">milindDocs</span>
        {/* Spacer to balance the layout */}
        <div style={{ width: 140 }} />
      </motion.div>

      {/* Main content */}
      <div className="docs-body">
        <div className="docs-sticky-col">
          <DocsStickyPanel onSendToCanvas={onSendNoteToCanvas} />
        </div>
        <div className="docs-editor-col">
          <MilindDoc onAddToCalendar={onAddToCalendar} onAddToTodo={onAddToTodo} />
        </div>
      </div>
    </div>
  );
}
