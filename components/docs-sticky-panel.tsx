"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CANVAS_PENDING_NOTE_KEY, PANEL_NOTES_KEY } from "@/lib/models";
import type { PanelNote } from "@/lib/models";

const NOTE_COLORS = [
  { value: "#fef9c3", label: "Yellow" },
  { value: "#fce7f3", label: "Pink" },
  { value: "#d1fae5", label: "Mint" },
  { value: "#dbeafe", label: "Blue" },
  { value: "#ede9fe", label: "Lavender" },
  { value: "#fff7ed", label: "Cream" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

function loadNotes(): PanelNote[] {
  try {
    const raw = localStorage.getItem(PANEL_NOTES_KEY);
    return raw ? (JSON.parse(raw) as PanelNote[]) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: PanelNote[]) {
  try {
    localStorage.setItem(PANEL_NOTES_KEY, JSON.stringify(notes));
  } catch { /* quota */ }
}

interface DocsStickyPanelProps {
  onSendToCanvas: (note: PanelNote) => void;
}

export function DocsStickyPanel({ onSendToCanvas }: DocsStickyPanelProps) {
  const [notes, setNotes] = useState<PanelNote[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [creating, setCreating] = useState(false);
  const [newText, setNewText] = useState("");
  const [newColor, setNewColor] = useState(NOTE_COLORS[0].value);

  useEffect(() => {
    setNotes(loadNotes());
  }, []);

  const createNote = () => {
    if (!newText.trim()) { setCreating(false); return; }
    const note: PanelNote = {
      id: uid(),
      text: newText.trim(),
      color: newColor,
      createdAt: Date.now(),
    };
    const updated = [note, ...notes];
    setNotes(updated);
    saveNotes(updated);
    setCreating(false);
    setNewText("");
    setNewColor(NOTE_COLORS[0].value);
  };

  const deleteNote = (id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    saveNotes(updated);
  };

  const commitEdit = (id: string) => {
    if (!editText.trim()) { setEditingId(null); return; }
    const updated = notes.map((n) => n.id === id ? { ...n, text: editText.trim() } : n);
    setNotes(updated);
    saveNotes(updated);
    setEditingId(null);
  };

  const changeColor = (id: string, color: string) => {
    const updated = notes.map((n) => n.id === id ? { ...n, color } : n);
    setNotes(updated);
    saveNotes(updated);
  };

  const handleSendToCanvas = (note: PanelNote) => {
    try {
      localStorage.setItem(CANVAS_PENDING_NOTE_KEY, JSON.stringify(note));
    } catch { /* quota */ }
    onSendToCanvas(note);
  };

  return (
    <div className="docs-sticky-panel">
      <div className="docs-sticky-panel-header">
        <span className="docs-sticky-panel-title">Notes</span>
        <button
          className="docs-sticky-add-btn"
          onClick={() => setCreating(true)}
          title="New note"
          type="button"
        >
          <Plus size={13} />
        </button>
      </div>

      <div className="docs-sticky-list">
        <AnimatePresence initial={false}>
          {creating && (
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="sticky-note-card"
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              initial={{ opacity: 0, y: -12, scale: 0.95 }}
              key="creating"
              style={{ background: newColor }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
            >
              <textarea
                autoFocus
                className="sticky-note-textarea"
                onChange={(e) => setNewText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); createNote(); }
                  if (e.key === "Escape") { setCreating(false); setNewText(""); }
                }}
                placeholder="Write a note…"
                rows={3}
                value={newText}
              />
              <div className="sticky-note-color-row">
                {NOTE_COLORS.map((c) => (
                  <button
                    className={`sticky-color-swatch${newColor === c.value ? " active" : ""}`}
                    key={c.value}
                    onClick={() => setNewColor(c.value)}
                    style={{ background: c.value }}
                    title={c.label}
                    type="button"
                  />
                ))}
              </div>
              <div className="sticky-note-footer">
                <button className="sticky-note-action" onClick={createNote} type="button">Save</button>
                <button
                  className="sticky-note-action muted"
                  onClick={() => { setCreating(false); setNewText(""); }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {notes.map((note) => (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="sticky-note-card"
              exit={{ opacity: 0, x: -20, scale: 0.95 }}
              initial={{ opacity: 0, y: 10 }}
              key={note.id}
              style={{ background: note.color }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
            >
              {editingId === note.id ? (
                <textarea
                  autoFocus
                  className="sticky-note-textarea"
                  onBlur={() => commitEdit(note.id)}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(note.id); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  rows={3}
                  value={editText}
                />
              ) : (
                <p
                  className="sticky-note-text"
                  onClick={() => { setEditingId(note.id); setEditText(note.text); }}
                >
                  {note.text}
                </p>
              )}
              <div className="sticky-note-color-row">
                {NOTE_COLORS.map((c) => (
                  <button
                    className={`sticky-color-swatch${note.color === c.value ? " active" : ""}`}
                    key={c.value}
                    onClick={() => changeColor(note.id, c.value)}
                    style={{ background: c.value }}
                    title={c.label}
                    type="button"
                  />
                ))}
              </div>
              <div className="sticky-note-footer">
                <button
                  className="sticky-note-action canvas-btn"
                  onClick={() => handleSendToCanvas(note)}
                  title="Send to canvas"
                  type="button"
                >
                  <Send size={10} /> Canvas
                </button>
                <button
                  className="sticky-note-action danger-btn"
                  onClick={() => deleteNote(note.id)}
                  title="Delete"
                  type="button"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {notes.length === 0 && !creating && (
          <div className="docs-sticky-empty">
            <p>No notes yet</p>
            <button onClick={() => setCreating(true)} type="button">
              <Plus size={12} /> Add your first note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
