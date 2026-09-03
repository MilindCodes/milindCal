"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface NewCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { summary: string; description: string; backgroundColor: string }) => Promise<void>;
}

const COLOR_OPTIONS = ["#4f8cff", "#21b6a8", "#ec4899", "#f59e0b", "#34d399", "#f87171"];

export function NewCalendarDialog({ open, onClose, onCreate }: NewCalendarDialogProps) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [backgroundColor, setBackgroundColor] = useState(COLOR_OPTIONS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /* Same contract as the event editor: Escape closes, and focus returns to
   * whatever opened the dialog rather than falling to the document body. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const returnTo = restoreFocusRef.current;
      if (returnTo && document.body.contains(returnTo)) {
        const active = document.activeElement;
        if (!active || active === document.body) returnTo.focus();
      }
    };
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (!summary.trim()) return;

    setIsSubmitting(true);
    try {
      await onCreate({
        summary: summary.trim(),
        description: description.trim(),
        backgroundColor
      });

      setSummary("");
      setDescription("");
      setBackgroundColor(COLOR_OPTIONS[0]);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div animate={{ opacity: 1 }} className="overlay" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="dialog"
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
          >
            <h3>Create calendar</h3>

            <label>
              Name
              <input onChange={(event) => setSummary(event.target.value)} value={summary} />
            </label>

            <label>
              Description
              <textarea onChange={(event) => setDescription(event.target.value)} rows={3} value={description} />
            </label>

            <div className="color-picker-row">
              {COLOR_OPTIONS.map((color) => (
                <button
                  className={`color-dot ${backgroundColor === color ? "selected" : ""}`}
                  key={color}
                  onClick={() => setBackgroundColor(color)}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
            </div>

            <div className="dialog-actions">
              <button className="ghost-button" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="primary-button" disabled={isSubmitting || !summary.trim()} onClick={handleSubmit} type="button">
                Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
