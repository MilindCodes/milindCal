"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DocsSidebar, type DocsSidebarTab } from "@/components/docs-sidebar";
import dynamic from "next/dynamic";
import { MilindDoc } from "@/components/milind-doc";
import { BrandMark } from "@/components/brand-mark";
import { useDocs, useEntityActions } from "@/components/entity-store-context";
import type { MilindDocCalendarMeta, MilindDocFile, CalendarEvent, PanelNote } from "@/lib/models";

/* The graph panel is toggled off by default, so keep its tree (and the
 * force-layout work it pulls in) out of the docs chunk until it's shown. */
const DocsGraphView = dynamic(
  () => import("@/components/docs-graph-view").then((m) => m.DocsGraphView),
  { ssr: false },
);

/** Extract plain text from Tiptap JSON for calendar description syncing */
function tiptapToPlainText(content: Record<string, unknown> | null): string {
  if (!content) return "";
  const parts: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    if (typeof node.text === "string") { parts.push(node.text); return; }
    const children = node.content as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      children.forEach(walk);
      const block = ["paragraph", "heading", "blockquote", "listItem", "codeBlock"];
      if (block.includes(node.type as string)) parts.push("\n");
    }
  };
  walk(content);
  return parts.join("").trim();
}

interface MilindDocsSectionProps {
  onClose: () => void;
  onAddToCalendar: (title: string, description: string) => void;
  onAddToTodo: (title: string) => void;
  onSendNoteToCanvas: (note: PanelNote) => void;
  /** When set, creates and opens a new doc converted from a calendar event */
  newDocFromCalendar?: MilindDocFile | null;
  calendarEvents?: CalendarEvent[];
  onSyncEventDescription?: (eventId: string, calendarId: string, description: string, eventPayload: {
    title: string; start: string; end: string; location: string; allDay: boolean;
  }) => Promise<void>;
  animationState?: "show" | "hidden";
}

function newEmptyDoc(): MilindDocFile {
  return {
    id: Math.random().toString(36).slice(2, 10),
    title: "Untitled",
    content: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    links: [],
  };
}

export function MilindDocsSection({
  onClose,
  onAddToCalendar,
  onAddToTodo,
  onSendNoteToCanvas,
  newDocFromCalendar,
  calendarEvents,
  onSyncEventDescription,
  animationState = "show",
}: MilindDocsSectionProps) {
  const docs = useDocs();
  const {
    addDoc,
    updateDoc,
    deleteDoc,
    pendingOpenDocId,
    clearPendingOpenDoc,
  } = useEntityActions();

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<DocsSidebarTab>("files");
  const [graphPanelWidth, setGraphPanelWidth] = useState(300);
  const [focusMode, setFocusMode] = useState(false);

  const startGraphResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = graphPanelWidth;

    const onMove = (ev: PointerEvent) => {
      const newW = Math.max(220, startW - (ev.clientX - startX));
      setGraphPanelWidth(newW);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const lastCalendarDocIdRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick the first doc as active once docs load (one-shot).
  const pickedInitialRef = useRef(false);
  useEffect(() => {
    if (pickedInitialRef.current) return;
    if (docs.length === 0) return;
    pickedInitialRef.current = true;
    setActiveDocId((cur) => cur ?? docs[0].id);
  }, [docs]);

  // Honour external "open this doc" requests (e.g. from backlinks panel).
  useEffect(() => {
    if (!pendingOpenDocId) return;
    setActiveDocId(pendingOpenDocId);
    clearPendingOpenDoc();
  }, [pendingOpenDocId, clearPendingOpenDoc]);

  // Auto-create docs from calendar events that have descriptions.
  // Uses addDoc (API-aware) so they reach milindDrive.
  useEffect(() => {
    if (!calendarEvents || calendarEvents.length === 0) return;
    for (const ev of calendarEvents) {
      if (!ev.description || !ev.description.trim()) continue;
      const stableId = `event-doc-${ev.id}`;
      const existing = docs.find(
        (d) => d.id === stableId || d.calendarMeta?.eventId === ev.id,
      );
      if (!existing) {
        addDoc({
          id: stableId,
          title: ev.title,
          content: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: ev.description }] }],
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          links: [],
          calendarMeta: {
            eventId: ev.id,
            calendarId: ev.calendarId,
            title: ev.title,
            start: ev.start,
            end: ev.end,
            description: ev.description,
            location: ev.location,
            allDay: ev.allDay,
          },
          autoCreatedFromCalendar: true,
        });
      }
    }
  // docs is needed to check for existing — adding docs changes docs, which
  // re-runs this effect, but the existence check makes it a no-op.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents]);

  useEffect(() => {
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, []);

  // Open a doc that was converted from a calendar event (passed by parent).
  useEffect(() => {
    if (!newDocFromCalendar) return;
    if (newDocFromCalendar.id === lastCalendarDocIdRef.current) return;
    lastCalendarDocIdRef.current = newDocFromCalendar.id;
    if (!docs.some((d) => d.id === newDocFromCalendar.id)) {
      addDoc(newDocFromCalendar);
    }
    setActiveDocId(newDocFromCalendar.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDocFromCalendar]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleNewDoc = useCallback(() => {
    const doc = newEmptyDoc();
    addDoc(doc);
    setActiveDocId(doc.id);
  }, [addDoc]);

  const handleDeleteDoc = useCallback((id: string) => {
    // Compute remaining BEFORE the delete so we can pick the next active doc.
    const remaining = docs.filter((d) => d.id !== id);
    deleteDoc(id);
    setActiveDocId((cur) => {
      if (cur !== id) return cur;
      return remaining.length ? remaining[0].id : null;
    });
  }, [deleteDoc, docs]);

  const handleRenameDoc = useCallback((id: string, newTitle: string) => {
    updateDoc(id, { title: newTitle, updatedAt: Date.now() });
  }, [updateDoc]);

  const handleDuplicateDoc = useCallback((id: string) => {
    const original = docs.find((d) => d.id === id);
    if (!original) return;
    const copy: MilindDocFile = {
      ...original,
      id: Math.random().toString(36).slice(2, 10),
      title: `${original.title || "Untitled"} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      links: [],
    };
    addDoc(copy);
  }, [addDoc, docs]);

  const handleSaveDoc = useCallback((updated: MilindDocFile) => {
    updateDoc(updated.id, updated);
    if (updated.calendarMeta && onSyncEventDescription) {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        const description = tiptapToPlainText(updated.content);
        void onSyncEventDescription(
          updated.calendarMeta!.eventId,
          updated.calendarMeta!.calendarId,
          description,
          {
            title: updated.calendarMeta!.title,
            start: updated.calendarMeta!.start,
            end: updated.calendarMeta!.end,
            location: updated.calendarMeta!.location ?? "",
            allDay: updated.calendarMeta!.allDay,
          }
        );
      }, 1500);
    }
  }, [updateDoc, onSyncEventDescription]);

  const handleUpdateGraphPos = useCallback((id: string, pos: { x: number; y: number }) => {
    updateDoc(id, { graphPos: pos });
  }, [updateDoc]);

  const handleUpdateDocColor = useCallback((id: string, color: string) => {
    updateDoc(id, { nodeColor: color || undefined });
  }, [updateDoc]);

  const handleAddGraphLink = useCallback((fromId: string, toId: string) => {
    const doc = docs.find((d) => d.id === fromId);
    if (!doc) return;
    const existing = doc.graphLinks ?? [];
    if (existing.includes(toId)) return;
    updateDoc(fromId, { graphLinks: [...existing, toId] });
  }, [updateDoc, docs]);

  // Reads the current doc content to send as the Google event description.
  // Doesn't mutate docs state, so no API call needed here.
  const handleSyncCalendarMeta = useCallback(async (meta: MilindDocCalendarMeta) => {
    const doc = docs.find((d) => d.calendarMeta?.eventId === meta.eventId);
    const description = doc ? tiptapToPlainText(doc.content) : "";
    void fetch(`/api/google/events/${meta.eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarId: meta.calendarId,
        event: {
          title: meta.title,
          description,
          location: meta.location ?? "",
          start: meta.start,
          end: meta.end,
          allDay: meta.allDay,
          attendees: [],
          recurrence: [],
          reminders: { useDefault: true, overrides: [] },
          eventType: "meeting",
          colorId: "9",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    });
  }, [docs]);

  const activeDoc = docs.find((d) => d.id === activeDocId) ?? null;

  // Silence unused-prop warnings without changing the public API; the parent
  // still passes animationState for orchestration but the inner spring is now
  // driven from calendar-workspace via the dive progress value.
  void animationState;

  return (
    <div className="milind-docs-section">
      {/* Top bar — click/kbd dismiss; wheel-up at editor top also dismisses */}
      <div className="docs-drag-zone">
        <div className="docs-drag-pill" />
        <motion.button
          className="docs-back-btn"
          layoutId="dive-today-pill"
          onClick={onClose}
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
        >
          <ArrowUp size={13} /> Back to calendar
          <kbd className="kbd-hint">⌘D</kbd>
        </motion.button>
        <BrandMark compact layoutId="dive-app-brand" />
        <div style={{ width: 160 }} />
      </div>

      {/* Main content: sidebar + editor/graph */}
      <div className={`docs-body docs-body--obsidian${focusMode ? " docs-body--focus" : ""}`}>
        <div className="docs-editor-col">
          <AnimatePresence mode="wait">
            {activeDoc ? (
              <motion.div
                key={activeDoc.id}
                className="docs-editor-transition"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: "100%", display: "flex", justifyContent: "center" }}
              >
                <MilindDoc
                  doc={activeDoc}
                  allDocs={docs}
                  onSave={handleSaveDoc}
                  onAddToCalendar={onAddToCalendar}
                  onAddToTodo={onAddToTodo}
                  onDocSelect={setActiveDocId}
                  onSyncCalendarMeta={handleSyncCalendarMeta}
                  focusMode={focusMode}
                  onToggleFocusMode={() => setFocusMode((v) => !v)}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                className="docs-empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="docs-empty-icon">
                  <svg width="48" height="56" viewBox="0 0 20 24" fill="none">
                    <path d="M12 0H2C0.9 0 0 0.9 0 2v20c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8l-8-8z" fill="#e8f0fe" />
                    <path d="M12 0v8h8L12 0z" fill="#c5d8fc" />
                    <path d="M4 13h12v1.5H4V13zm0 3h12v1.5H4V16zm0 3h8v1.5H4V19z" fill="#4285f4" fillOpacity="0.5" />
                  </svg>
                </div>
                <p>No document selected</p>
                <span>Pick a document from the sidebar, or create a new one.</span>
                <motion.button
                  className="docs-empty-create-btn"
                  onClick={handleNewDoc}
                  type="button"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  Create your first doc
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {!focusMode && (
            <motion.div
              key="sidebar"
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="docs-sidebar-wrapper"
              style={{ flexShrink: 0, width: 300, overflow: "hidden" }}
            >
              <DocsSidebar
                docs={docs}
                activeDocId={activeDocId}
                activeTab={sidebarTab}
                graphOpen={showGraph}
                panelNotes={[]}
                onDocSelect={setActiveDocId}
                onNewDoc={handleNewDoc}
                onDeleteDoc={handleDeleteDoc}
                onRenameDoc={handleRenameDoc}
                onTabChange={setSidebarTab}
                onToggleGraph={() => setShowGraph((v) => !v)}
                onSendNoteToCanvas={onSendNoteToCanvas}
                onDuplicateDoc={handleDuplicateDoc}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {showGraph && (
          <div className="docs-graph-panel" style={{ width: graphPanelWidth }}>
            <div className="docs-graph-resize-handle" onPointerDown={startGraphResize} />
            <DocsGraphView
              docs={docs}
              activeDocId={activeDocId}
              onDocSelect={setActiveDocId}
              onUpdateGraphPos={handleUpdateGraphPos}
              onUpdateDocColor={handleUpdateDocColor}
              onAddGraphLink={handleAddGraphLink}
            />
          </div>
        )}
      </div>
    </div>
  );
}
