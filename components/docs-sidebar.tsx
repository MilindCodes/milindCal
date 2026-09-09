"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Network,
  Pencil,
  Pin,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MilindDocFile, PanelNote } from "@/lib/models";
import { DocsStickyPanel } from "@/components/docs-sticky-panel";
import { useUniversalDraggable, useUniversalDroppable } from "@/components/universal-drag-layer";
import { payloadFromDoc } from "@/lib/entity-store";

export type DocsSidebarTab = "files" | "notes";
type SortBy = "modified" | "created" | "name";

interface DocsSidebarProps {
  docs: MilindDocFile[];
  activeDocId: string | null;
  activeTab: DocsSidebarTab;
  graphOpen: boolean;
  panelNotes: PanelNote[];
  onDocSelect: (id: string) => void;
  onNewDoc: () => void;
  onDeleteDoc: (id: string) => void;
  onRenameDoc: (id: string, newTitle: string) => void;
  onTabChange: (tab: DocsSidebarTab) => void;
  onToggleGraph: () => void;
  onSendNoteToCanvas: (note: PanelNote) => void;
  onDuplicateDoc?: (id: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  docId: string;
}

function formatRelativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function estimateWordCount(doc: MilindDocFile): number {
  if (!doc.content) return 0;
  const walk = (node: Record<string, unknown>): string => {
    if (typeof node.text === "string") return node.text;
    const children = node.content as Record<string, unknown>[] | undefined;
    return Array.isArray(children) ? children.map(walk).join(" ") : "";
  };
  const text = walk(doc.content as Record<string, unknown>).trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Draggable doc row */
const DocFileItem = memo(function DocFileItem({
  doc,
  isActive,
  isFocused,
  isRenaming,
  renameValue,
  renameInputRef,
  onDocSelect,
  onDeleteDoc,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onRenameKeyDown,
  onContextMenu,
}: {
  doc: MilindDocFile;
  isActive: boolean;
  isFocused: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onDocSelect: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  onStartRename: (doc: MilindDocFile, e: React.MouseEvent) => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const drag = useUniversalDraggable(payloadFromDoc(doc));
  const wc = estimateWordCount(doc);

  return (
    <div
      {...drag.attributes}
      {...drag.listeners}
      className={`gd-file-item${isActive ? " active" : ""}${isFocused ? " kb-focused" : ""}${drag.isDragging ? " dragging" : ""}`}
      onClick={() => !isRenaming && onDocSelect(doc.id)}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => { if (e.key === "Enter" && !isRenaming) onDocSelect(doc.id); }}
      ref={drag.setNodeRef}
      style={{ touchAction: "none", opacity: drag.isDragging ? 0.4 : 1 }}
      tabIndex={0}
    >
      <div className={`gd-file-icon${doc.calendarMeta ? " gd-file-icon--cal" : ""}`}>
        <FileText size={13} />
        {doc.calendarMeta && <span className="gd-file-cal-dot" />}
      </div>

      <div className="gd-file-info">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="gd-file-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={onRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            type="text"
          />
        ) : (
          <span
            className="gd-file-title"
            onDoubleClick={(e) => onStartRename(doc, e)}
            title={doc.title || "Untitled"}
          >
            {doc.title || "Untitled"}
          </span>
        )}
        <div className="gd-file-meta">
          <span className="gd-file-meta-time">
            <Clock size={9} />
            {formatRelativeDate(doc.updatedAt)}
          </span>
          {wc > 0 && (
            <span className="gd-file-meta-wc">{wc}w</span>
          )}
        </div>
      </div>

      <div className="gd-file-actions">
        <button
          className="gd-file-action-btn"
          onClick={(e) => { e.stopPropagation(); onStartRename(doc, e); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Rename"
          type="button"
        >
          <Pencil size={10} />
        </button>
        <button
          className="gd-file-action-btn gd-file-action-btn--danger"
          onClick={(e) => { e.stopPropagation(); onDeleteDoc(doc.id); }}
          onPointerDown={(e) => e.stopPropagation()}
          title="Delete"
          type="button"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
});

function groupDocsByDate(docs: MilindDocFile[]): { label: string; docs: MilindDocFile[] }[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(now.getDate() - 30);

  const groups: { label: string; docs: MilindDocFile[] }[] = [
    { label: "Today", docs: [] },
    { label: "Yesterday", docs: [] },
    { label: "Past 7 days", docs: [] },
    { label: "Past 30 days", docs: [] },
    { label: "Earlier", docs: [] },
  ];

  for (const doc of docs) {
    const d = new Date(doc.updatedAt);
    d.setHours(0, 0, 0, 0);
    if (d >= now) groups[0].docs.push(doc);
    else if (d >= yesterday) groups[1].docs.push(doc);
    else if (d >= weekAgo) groups[2].docs.push(doc);
    else if (d >= monthAgo) groups[3].docs.push(doc);
    else groups[4].docs.push(doc);
  }

  return groups.filter((g) => g.docs.length > 0);
}

const itemVariants = {
  hidden: { opacity: 0, y: 15, filter: "blur(4px)", scale: 0.98 },
  visible: (i: number) => ({
    opacity: 1, y: 0, filter: "blur(0px)", scale: 1,
    transition: { delay: i * 0.04, type: "spring", stiffness: 350, damping: 28 },
  }),
  exit: { opacity: 0, scale: 0.96, filter: "blur(2px)", transition: { duration: 0.15 } },
};

export function DocsSidebar({
  docs,
  activeDocId,
  activeTab,
  graphOpen,
  panelNotes: _panelNotes,
  onDocSelect,
  onNewDoc,
  onDeleteDoc,
  onRenameDoc,
  onTabChange,
  onToggleGraph,
  onSendNoteToCanvas,
  onDuplicateDoc,
}: DocsSidebarProps) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("modified");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close sort menu on outside click
  useEffect(() => {
    const handleOut = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, []);

  // Close context menu on outside click / escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleOut = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    setTimeout(() => {
      document.addEventListener("mousedown", handleOut);
      document.addEventListener("keydown", handleEsc);
    }, 0);
    return () => {
      document.removeEventListener("mousedown", handleOut);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  /* Both of these ran on every render — a full copy-and-sort of the library
   * plus a filter — even when neither the docs nor the query had changed, and
   * this component re-renders on every keystroke in the search box. */
  const sortedDocs = useMemo(
    () =>
      [...docs].sort((a, b) => {
        if (sortBy === "name")
          return (a.title || "Untitled").localeCompare(b.title || "Untitled");
        if (sortBy === "created") return b.createdAt - a.createdAt;
        return b.updatedAt - a.updatedAt;
      }),
    [docs, sortBy],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return sortedDocs;
    return sortedDocs.filter((d) => (d.title || "Untitled").toLowerCase().includes(q));
  }, [sortedDocs, query]);

  /* Sync focusedIndex to activeDocId when switching.
   *
   * The dependency was previously `filtered.map(d => d.id).join(",")`, which
   * allocated an array and a string on every render just to produce a
   * comparison key. `filtered` is now referentially stable between real
   * changes, so it can be depended on directly. */
  useEffect(() => {
    if (activeDocId) {
      const idx = filtered.findIndex((d) => d.id === activeDocId);
      if (idx >= 0) setFocusedIndex(idx);
    }
  }, [activeDocId, filtered]);

  // Keyboard navigation
  useEffect(() => {
    if (activeTab !== "files") return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = Math.min(i + 1, filtered.length - 1);
          if (filtered[next]) onDocSelect(filtered[next].id);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = Math.max(i - 1, 0);
          if (filtered[next]) onDocSelect(filtered[next].id);
          return next;
        });
      } else if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, filtered, onDocSelect]);

  const startRename = useCallback((doc: MilindDocFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(doc.id);
    setRenameValue(doc.title || "Untitled");
    setContextMenu(null);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId) {
      const val = renameValue.trim() || "Untitled";
      onRenameDoc(renamingId, val);
    }
    setRenamingId(null);
  }, [renamingId, renameValue, onRenameDoc]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenamingId(null);
    e.stopPropagation();
  }, [commitRename]);

  const openContextMenu = useCallback((e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, docId });
  }, []);

  const handleDuplicate = useCallback((docId: string) => {
    onDuplicateDoc?.(docId);
    setContextMenu(null);
  }, [onDuplicateDoc]);

  const sortLabels: Record<SortBy, string> = {
    modified: "Last modified",
    created: "Date created",
    name: "Name",
  };

  const listDroppable = useUniversalDroppable({ id: "docs-list", targetKind: "doc" });

  const renderDocItem = (doc: MilindDocFile, index: number) => {
    const isActive = doc.id === activeDocId;
    const isRenaming = renamingId === doc.id;
    const isFocused = focusedIndex === index;

    return (
      <motion.div
        key={doc.id}
        custom={index}
        variants={itemVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        layout
      >
        <DocFileItem
          doc={doc}
          isActive={isActive}
          isFocused={isFocused}
          isRenaming={isRenaming}
          renameValue={renameValue}
          renameInputRef={renameInputRef}
          onDocSelect={onDocSelect}
          onDeleteDoc={onDeleteDoc}
          onStartRename={startRename}
          onRenameChange={setRenameValue}
          onCommitRename={commitRename}
          onRenameKeyDown={handleRenameKeyDown}
          onContextMenu={(e) => openContextMenu(e, doc.id)}
        />
      </motion.div>
    );
  };

  const totalWords = docs.reduce((acc, d) => acc + estimateWordCount(d), 0);

  return (
    <div className="docs-sidebar">
      {/* Tab strip */}
      <motion.div className="docs-sidebar__tabs" layoutId="dive-view-pill">
        <button
          className={`docs-sidebar__tab${activeTab === "files" ? " active" : ""}`}
          onClick={() => onTabChange("files")}
          type="button"
        >
          <FileText size={12} />
          Files
        </button>
        <button
          className={`docs-sidebar__tab${activeTab === "notes" ? " active" : ""}`}
          onClick={() => onTabChange("notes")}
          type="button"
        >
          <StickyNote size={12} />
          Notes
        </button>
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === "files" ? (
          <motion.div
            key="files"
            animate={{ opacity: 1, x: 0 }}
            className="docs-sidebar__pane"
            exit={{ opacity: 0, x: -8 }}
            initial={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Header */}
            <div className="gd-sidebar-header">
              <span className="gd-sidebar-title">My docs</span>
              <div className="gd-sidebar-header-actions">
                <div className="gd-sort-wrapper" ref={sortMenuRef}>
                  <button
                    aria-expanded={showSortMenu}
                    aria-haspopup="menu"
                    aria-label={`Sort documents. Current: ${sortLabels[sortBy]}`}
                    className={`gd-icon-btn${showSortMenu ? " active" : ""}`}
                    onClick={() => setShowSortMenu((v) => !v)}
                    title={`Sort: ${sortLabels[sortBy]}`}
                    type="button"
                  >
                    <ChevronDown aria-hidden="true" size={12} />
                  </button>
                  <AnimatePresence>
                    {showSortMenu && (
                      <motion.div
                        className="gd-sort-menu"
                        initial={{ opacity: 0, scale: 0.94, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: -6 }}
                        transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
                      >
                        <div className="gd-sort-menu__label">Sort by</div>
                        {(["modified", "created", "name"] as SortBy[]).map((s) => (
                          <button
                            key={s}
                            className={`gd-sort-option${sortBy === s ? " active" : ""}`}
                            onClick={() => { setSortBy(s); setShowSortMenu(false); }}
                            type="button"
                          >
                            {sortBy === s && <Check size={10} />}
                            <span>{sortLabels[s]}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  aria-label="Toggle graph view"
                  aria-pressed={graphOpen}
                  className={`gd-icon-btn${graphOpen ? " active" : ""}`}
                  onClick={onToggleGraph}
                  title="Graph view"
                  type="button"
                >
                  <Network aria-hidden="true" size={12} />
                </button>
              </div>
            </div>

            {/* New doc button */}
            <motion.button
              className="gd-new-doc-btn"
              onClick={onNewDoc}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              <Plus size={14} />
              New document
            </motion.button>

            {/* Search */}
            <div className="gd-search">
              <Search size={11} />
              <input
                ref={searchRef}
                onChange={(e) => { setQuery(e.target.value); setFocusedIndex(-1); }}
                placeholder="Search…"
                type="text"
                value={query}
              />
              <AnimatePresence>
                {query && (
                  <motion.button
                    className="gd-search-clear"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.1 }}
                    onClick={() => setQuery("")}
                    type="button"
                  >
                    <X size={10} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* File list */}
            <div
              className={`gd-file-list${listDroppable.isOver ? " universal-droppable--active" : ""}`}
              ref={listDroppable.setNodeRef}
            >
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <motion.div
                    key="empty"
                    className="gd-empty-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    {docs.length === 0 ? (
                      <>
                        <div className="gd-empty-icon">
                          <FileText size={32} />
                        </div>
                        <p>No documents yet</p>
                        <span>Create your first document to get started.</span>
                        <button className="gd-empty-cta" onClick={onNewDoc} type="button">
                          <Plus size={12} />
                          New document
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="gd-empty-icon">
                          <Search size={28} />
                        </div>
                        <p>No results</p>
                        <span>No documents match &ldquo;{query}&rdquo;</span>
                      </>
                    )}
                  </motion.div>
                ) : query || sortBy === "name" ? (
                  filtered.map((doc, i) => renderDocItem(doc, i))
                ) : (
                  groupDocsByDate(filtered).map((group) => (
                    <motion.div key={group.label} className="gd-date-group" layout>
                      <div className="gd-date-group__label">{group.label}</div>
                      <AnimatePresence mode="popLayout">
                        {group.docs.map((doc) => renderDocItem(doc, filtered.indexOf(doc)))}
                      </AnimatePresence>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            {docs.length > 0 && (
              <div className="gd-sidebar-footer">
                <span>{docs.length} doc{docs.length !== 1 ? "s" : ""}</span>
                {totalWords > 0 && (
                  <span className="gd-footer-sep">·</span>
                )}
                {totalWords > 0 && (
                  <span>{totalWords.toLocaleString()} words total</span>
                )}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="notes"
            animate={{ opacity: 1, x: 0 }}
            className="docs-sidebar__pane docs-sidebar__pane--notes"
            exit={{ opacity: 0, x: 8 }}
            initial={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
          >
            <DocsStickyPanel onSendToCanvas={onSendNoteToCanvas} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            ref={contextMenuRef}
            className="gd-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            initial={{ opacity: 0, scale: 0.92, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -8 }}
            transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              className="gd-context-item"
              onClick={() => {
                const doc = docs.find(d => d.id === contextMenu.docId);
                if (doc) startRename(doc, { stopPropagation: () => {} } as React.MouseEvent);
              }}
              type="button"
            >
              <Pencil size={12} />
              Rename
            </button>
            {onDuplicateDoc && (
              <button
                className="gd-context-item"
                onClick={() => handleDuplicate(contextMenu.docId)}
                type="button"
              >
                <Copy size={12} />
                Duplicate
              </button>
            )}
            <button
              className="gd-context-item"
              onClick={() => {
                onDocSelect(contextMenu.docId);
                setContextMenu(null);
              }}
              type="button"
            >
              <Pin size={12} />
              Open
            </button>
            <div className="gd-context-divider" />
            <button
              className="gd-context-item gd-context-item--danger"
              onClick={() => {
                onDeleteDoc(contextMenu.docId);
                setContextMenu(null);
              }}
              type="button"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
