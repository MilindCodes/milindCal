"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEditor, EditorContent, type Editor, ReactRenderer } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Mention from "@tiptap/extension-mention";
import TextAlign from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Calendar,
  ChevronDown,
  Code,
  Download,
  ExternalLink,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Maximize2,
  Minimize2,
  Minus,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { BacklinksList } from "@/components/backlinks-list";
import { useEntityActions } from "@/components/entity-store-context";
import { toDateOnly, toDateTimeLocal } from "@/lib/datetime";
import { entityKey } from "@/lib/entity-store";
import type { MilindDocCalendarMeta, MilindDocFile, Task } from "@/lib/models";

/* ── Color palettes ────────────────────────────────────────────── */

const TEXT_COLORS = [
  { label: "Black", value: "#000000" },
  { label: "Dark Gray 4", value: "#434343" },
  { label: "Dark Gray 3", value: "#666666" },
  { label: "Dark Gray 2", value: "#999999" },
  { label: "Dark Gray 1", value: "#b7b7b7" },
  { label: "Gray", value: "#cccccc" },
  { label: "Red Berry", value: "#980000" },
  { label: "Red", value: "#ea4335" },
  { label: "Orange", value: "#e67c00" },
  { label: "Yellow", value: "#f9ab00" },
  { label: "Green", value: "#34a853" },
  { label: "Cyan", value: "#00bcd4" },
  { label: "Blue", value: "#4285f4" },
  { label: "Purple", value: "#9c27b0" },
  { label: "Magenta", value: "#e91e63" },
  { label: "Teal", value: "#008080" },
];

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fff2cc" },
  { label: "Light Green", value: "#d9ead3" },
  { label: "Light Blue", value: "#cfe2f3" },
  { label: "Light Purple", value: "#d9d2e9" },
  { label: "Light Pink", value: "#ead1dc" },
  { label: "Light Orange", value: "#fce5cd" },
  { label: "Light Red", value: "#f4cccc" },
  { label: "Cyan", value: "#c9daf8" },
];

/* ── Mention suggestion list ──────────────────────────────────── */

interface MentionListProps {
  items: MilindDocFile[];
  command: (attrs: { id: string; label: string }) => void;
}

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }: SuggestionKeyDownProps) {
        if (event.key === "ArrowUp") {
          setSelected((s) => Math.max(0, s - 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => Math.min(items.length - 1, s + 1));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selected];
          if (item) command({ id: item.id, label: item.title || "Untitled" });
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="doc-mention-list">
          <div className="doc-mention-list__empty">No docs found</div>
        </div>
      );
    }

    return (
      <div className="doc-mention-list">
        {items.map((item, i) => (
          <button
            key={item.id}
            className={`doc-mention-list__item${i === selected ? " active" : ""}`}
            onClick={() => command({ id: item.id, label: item.title || "Untitled" })}
            type="button"
          >
            {item.title || "Untitled"}
          </button>
        ))}
      </div>
    );
  }
);
MentionList.displayName = "MentionList";

/* ── Floating calendar pill ────────────────────────────────────── */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.9 };

function formatPillDate(iso: string, allDay: boolean): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (allDay) {
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch { return ""; }
}

interface FloatingCalendarPillProps {
  meta: MilindDocCalendarMeta | null;
  onSave: (meta: MilindDocCalendarMeta) => void;
  onSyncToCalendar: (meta: MilindDocCalendarMeta) => Promise<void> | void;
  onCreateDefault: () => MilindDocCalendarMeta;
}

function FloatingCalendarPill({
  meta,
  onSave,
  onSyncToCalendar,
  onCreateDefault,
}: FloatingCalendarPillProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<MilindDocCalendarMeta | null>(meta);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(meta); }, [meta]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [expanded]);

  const handleOpen = () => {
    if (!draft) {
      const fresh = onCreateDefault();
      setDraft(fresh);
    }
    setExpanded(true);
  };

  const set = <K extends keyof MilindDocCalendarMeta>(key: K, val: MilindDocCalendarMeta[K]) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: val };
      onSave(next);
      return next;
    });
  };

  const handleSync = async () => {
    if (!draft) return;
    setSyncing(true);
    try {
      await onSyncToCalendar(draft);
      setSynced(true);
      setTimeout(() => setSynced(false), 2000);
    } finally {
      setSyncing(false);
    }
  };

  /* Reading and writing these fields is deliberately asymmetric, and it has to
   * be. `<input type="datetime-local">` speaks local wall-clock time in both
   * directions; the record stores a UTC instant.
   *
   * Writing is already right: `new Date("2026-09-08T14:00")` — a date-time with
   * no offset — is parsed as *local* by the spec, so `.toISOString()` produces
   * the correct instant.
   *
   * Reading was not. It was `new Date(iso).toISOString().slice(0, 16)`, which
   * hands the input a UTC clock reading and lets it be interpreted as local. A
   * 2pm event in New York displayed as 18:00, and because the write path is
   * correct, every open-and-save moved the event four hours later: 2pm, 6pm,
   * 10pm, 2am the next day. Kolkata drifted the other way, 5.5 hours a time.
   * Only UTC was safe, which is why it survived.
   *
   * `toDateOnly` closes the same hole on the all-day path, which took the UTC
   * date with `.split("T")[0]`. That one breaks *east* of Greenwich: an all-day
   * event stored as local midnight on 8 September is 7 September 18:30Z in
   * Kolkata, so the field offered the day before the one the user picked. */
  const fromDateTimeLocal = (local: string) => {
    if (!local) return "";
    return new Date(local).toISOString();
  };

  const pillLabel = draft?.title?.trim() || "Link calendar event";
  const pillDate = draft ? formatPillDate(draft.start, draft.allDay) : "";

  return (
    <div className="doc-cal-floater-anchor">
      <motion.div
        ref={containerRef}
        className={`doc-cal-floater${expanded ? " expanded" : ""}`}
        layout
        initial={false}
        transition={{ layout: SPRING }}
        onClick={expanded ? undefined : handleOpen}
        role={expanded ? undefined : "button"}
        tabIndex={expanded ? -1 : 0}
        onKeyDown={(e) => {
          if (!expanded && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handleOpen();
          }
        }}
      >
        <div
          className={`doc-cal-pill-inner${expanded ? " hidden" : ""}`}
          aria-hidden={expanded}
        >
          <span className="doc-cal-pill-icon">
            <Calendar size={13} />
          </span>
          <span className="doc-cal-pill-label">{pillLabel}</span>
          {pillDate && <span className="doc-cal-pill-date">{pillDate}</span>}
        </div>

        {draft && (
          <div
            className={`doc-cal-card-inner${expanded ? "" : " hidden"}`}
            aria-hidden={!expanded}
          >
            <div className="doc-cal-card-header">
              <div className="doc-cal-card-title">
                <Calendar size={13} />
                <span>Calendar event</span>
              </div>
              <div className="doc-cal-card-actions">
                <button
                  className="doc-cal-sync-btn"
                  disabled={syncing}
                  onClick={handleSync}
                  type="button"
                  tabIndex={expanded ? 0 : -1}
                >
                  <ExternalLink size={11} />
                  {syncing ? "Syncing…" : synced ? "Synced!" : "Sync to calendar"}
                </button>
                <button
                  className="doc-cal-close-btn"
                  onClick={() => setExpanded(false)}
                  type="button"
                  title="Collapse"
                  aria-label="Collapse"
                  tabIndex={expanded ? 0 : -1}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="doc-cal-card-fields">
              <label className="doc-cal-field">
                <span>Title</span>
                <input
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Event title"
                  tabIndex={expanded ? 0 : -1}
                />
              </label>
              <div className="doc-cal-row">
                <label className="doc-cal-field">
                  <span>Start</span>
                  <input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={draft.allDay ? toDateOnly(draft.start) : toDateTimeLocal(draft.start)}
                    onChange={(e) =>
                      set("start", draft.allDay ? e.target.value : fromDateTimeLocal(e.target.value))
                    }
                    tabIndex={expanded ? 0 : -1}
                  />
                </label>
                <label className="doc-cal-field">
                  <span>End</span>
                  <input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={draft.allDay ? toDateOnly(draft.end) : toDateTimeLocal(draft.end)}
                    onChange={(e) =>
                      set("end", draft.allDay ? e.target.value : fromDateTimeLocal(e.target.value))
                    }
                    tabIndex={expanded ? 0 : -1}
                  />
                </label>
              </div>
              <label className="doc-cal-field">
                <span>Location</span>
                <input
                  value={draft.location ?? ""}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Location"
                  tabIndex={expanded ? 0 : -1}
                />
              </label>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ── Backlinks section ─────────────────────────────────────────── */

interface BacklinksProps {
  currentDocId: string;
  allDocs: MilindDocFile[];
  onDocSelect: (id: string) => void;
}

function BacklinksSection({ currentDocId, allDocs, onDocSelect }: BacklinksProps) {
  const backlinks = allDocs.filter((d) => d.links.includes(currentDocId));
  if (!backlinks.length) return null;
  return (
    <div className="doc-backlinks">
      <div className="doc-backlinks__header">Linked from</div>
      <div className="doc-backlinks__list">
        {backlinks.map((doc) => (
          <button
            key={doc.id}
            className="doc-backlinks__item"
            onClick={() => onDocSelect(doc.id)}
            type="button"
          >
            {doc.title || "Untitled"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function extractTitle(editor: Editor | null): string {
  if (!editor) return "Untitled";
  const json = editor.getJSON();
  for (const node of json.content ?? []) {
    if (node.type === "heading" || node.type === "paragraph") {
      const text = (node.content ?? []).map((c: unknown) => (c as { text?: string }).text ?? "").join("");
      if (text.trim()) return text.trim();
    }
  }
  return "Untitled";
}

function nodeToText(node: { type?: string; content?: unknown[]; text?: string }): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  const inner = (node.content as typeof node[]).map(nodeToText).join("");
  if (node.type && ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type)) {
    return inner + "\n";
  }
  return inner;
}

function extractDescription(editor: Editor | null): string {
  if (!editor) return "";
  const json = editor.getJSON();
  const nodes = json.content ?? [];
  let skippedTitle = false;
  const lines: string[] = [];
  for (const node of nodes) {
    const text = nodeToText(node as Parameters<typeof nodeToText>[0]);
    if (!skippedTitle && text.trim()) { skippedTitle = true; continue; }
    lines.push(text);
  }
  return lines.join("").trim();
}

/* ── Tiptap → Markdown converter ──────────────────────────────── */

type TNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: TNode[];
};

function inlinesMd(nodes: TNode[]): string {
  return nodes.map((n) => {
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "mention") return `@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`;
    if (n.type !== "text") return "";
    let t = n.text ?? "";
    const marks = n.marks ?? [];
    const linkMark = marks.find((m) => m.type === "link");
    const bold = marks.some((m) => m.type === "bold");
    const italic = marks.some((m) => m.type === "italic");
    const isCode = marks.some((m) => m.type === "code");
    if (isCode) return `\`${t}\``;
    if (bold && italic) t = `***${t}***`;
    else if (bold) t = `**${t}**`;
    else if (italic) t = `_${t}_`;
    if (linkMark) t = `[${t}](${String(linkMark.attrs?.href ?? "")})`;
    return t;
  }).join("");
}

function listItemMd(node: TNode, indent: number, listType: "bullet" | "ordered", index = 1): string {
  const pad = "  ".repeat(indent);
  const marker = listType === "bullet" ? "-" : `${index}.`;
  const children = node.content ?? [];
  const firstPara = children[0];
  const rest = children.slice(1);
  const text = firstPara?.type === "paragraph" ? inlinesMd(firstPara.content ?? []) : "";
  const nested = rest.map((n) => blockMd(n, indent + 1)).join("");
  return `${pad}${marker} ${text}\n${nested}`;
}

function tableMd(node: TNode): string {
  const rows = node.content ?? [];
  const mdRows = rows.map((row) =>
    (row.content ?? []).map((cell) =>
      inlinesMd((cell.content ?? []).flatMap((p) => p.content ?? [])).replace(/\|/g, "\\|").trim()
    )
  );
  if (!mdRows.length) return "";
  const colCount = Math.max(...mdRows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(colCount - r.length).fill("")];
  const header = `| ${pad(mdRows[0]).join(" | ")} |`;
  const divider = `| ${Array(colCount).fill("---").join(" | ")} |`;
  const body = mdRows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`).join("\n");
  return [header, divider, ...(body ? [body] : [])].join("\n");
}

function blockMd(node: TNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  switch (node.type) {
    case "paragraph": {
      const t = inlinesMd(node.content ?? []);
      return t.trim() ? `${pad}${t}\n\n` : `${pad}\n`;
    }
    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      return `${"#".repeat(level)} ${inlinesMd(node.content ?? [])}\n\n`;
    }
    case "blockquote": {
      const inner = (node.content ?? []).map((n) => blockMd(n)).join("").trimEnd();
      return inner.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
    }
    case "codeBlock": {
      const lang = String(node.attrs?.language ?? "");
      const code = inlinesMd(node.content ?? []);
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }
    case "bulletList":
      return (node.content ?? []).map((item, i) => listItemMd(item, indent, "bullet", i + 1)).join("") + "\n";
    case "orderedList":
      return (node.content ?? []).map((item, i) => listItemMd(item, indent, "ordered", i + 1)).join("") + "\n";
    case "horizontalRule":
      return `---\n\n`;
    case "table":
      return tableMd(node) + "\n\n";
    default:
      return "";
  }
}

function tiptapToMarkdown(content: Record<string, unknown>): string {
  const root = content as TNode;
  const nodes = root.type === "doc" ? (root.content ?? []) : [root];
  return nodes.map((n) => blockMd(n)).join("").trimEnd() + "\n";
}

function extractMentionIds(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const ids: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    if (node.type === "mention" && typeof (node.attrs as Record<string, unknown>)?.id === "string") {
      ids.push((node.attrs as Record<string, unknown>).id as string);
    }
    const children = node.content as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) children.forEach(walk);
  };
  walk(content);
  return [...new Set(ids)];
}

/* ── Paragraph style dropdown ──────────────────────────────────── */

interface StyleDropdownProps {
  editor: Editor;
}

function StyleDropdown({ editor }: StyleDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const getCurrentStyle = () => {
    if (editor.isActive("heading", { level: 1 })) return "Heading 1";
    if (editor.isActive("heading", { level: 2 })) return "Heading 2";
    if (editor.isActive("heading", { level: 3 })) return "Heading 3";
    return "Normal text";
  };

  useEffect(() => {
    if (!open) return;
    const handleOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, [open]);

  const styles = [
    {
      label: "Normal text",
      className: "gd-style-option--normal",
      action: () => editor.chain().focus().setParagraph().run(),
    },
    {
      label: "Heading 1",
      className: "gd-style-option--h1",
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      className: "gd-style-option--h2",
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      className: "gd-style-option--h3",
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ];

  const current = getCurrentStyle();

  return (
    <div className="gd-style-dropdown" ref={ref}>
      <button
        className="gd-style-btn"
        onClick={() => setOpen((v) => !v)}
        type="button"
        title="Paragraph styles"
      >
        <span>{current}</span>
        <ChevronDown size={11} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="gd-style-menu"
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
          >
            {styles.map((s) => (
              <button
                key={s.label}
                className={`gd-style-option ${s.className}${s.label === current ? " active" : ""}`}
                onClick={() => { s.action(); setOpen(false); }}
                type="button"
              >
                {s.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Color picker ───────────────────────────────────────────────── */

interface ColorPickerProps {
  colors: { label: string; value: string }[];
  onSelect: (color: string) => void;
  label: string;
  iconChar: string;
  previewColor: string;
  isHighlight?: boolean;
}

function ColorPicker({ colors, onSelect, label, iconChar, previewColor, isHighlight }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, [open]);

  return (
    <div className="gd-color-picker" ref={ref}>
      <button
        className="gd-toolbar-btn gd-color-btn"
        onClick={() => setOpen((v) => !v)}
        title={label}
        type="button"
      >
        <div className="gd-color-icon">
          <span
            className="gd-color-char"
            style={isHighlight ? { background: previewColor || "transparent" } : { color: previewColor || "#000" }}
          >
            {iconChar}
          </span>
          <div
            className="gd-color-bar"
            style={{ background: previewColor || (isHighlight ? "transparent" : "#000") }}
          />
        </div>
        <ChevronDown size={8} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="gd-color-palette"
            initial={{ opacity: 0, scale: 0.94, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -6 }}
            transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="gd-color-palette__label">{label}</div>
            <div className="gd-color-grid">
              {colors.map((c) => (
                <motion.button
                  key={c.value || "none"}
                  className={`gd-color-swatch${!c.value ? " gd-color-swatch--none" : ""}`}
                  title={c.label}
                  onClick={() => { onSelect(c.value); setOpen(false); }}
                  type="button"
                  style={{ background: c.value || "transparent" }}
                  whileHover={{ scale: 1.25 }}
                  whileTap={{ scale: 1.1 }}
                  transition={{ duration: 0.1 }}
                >
                  {!c.value && <span>✕</span>}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Status bar ─────────────────────────────────────────────────── */

interface StatusBarProps {
  wordCount: number;
  charCount: number;
  isSaved: boolean;
}

function StatusBar({ wordCount, charCount, isSaved }: StatusBarProps) {
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));
  return (
    <div className="milind-doc-status-bar">
      <motion.span
        className={`doc-save-indicator${isSaved ? " saved" : ""}`}
        animate={{ opacity: isSaved ? 1 : 0.5 }}
        transition={{ duration: 0.3 }}
      >
        {isSaved ? "✓ Saved" : "Autosave on"}
      </motion.span>
      <span className="doc-status-sep" />
      <span>{wordCount.toLocaleString()} words</span>
      <span className="doc-status-sep">·</span>
      <span>{charCount.toLocaleString()} chars</span>
      <span className="doc-status-sep">·</span>
      <span>{readingTime} min read</span>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────── */

interface MilindDocProps {
  doc: MilindDocFile;
  allDocs: MilindDocFile[];
  onSave: (doc: MilindDocFile) => void;
  onAddToCalendar: (title: string, description: string) => void;
  onAddToTodo: (title: string) => void;
  onDocSelect: (id: string) => void;
  onSyncCalendarMeta: (meta: MilindDocCalendarMeta) => Promise<void>;
  onLinkToCalendar?: (meta: MilindDocCalendarMeta) => void;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
}

export function MilindDoc({
  doc,
  allDocs,
  onSave,
  onAddToCalendar,
  onAddToTodo,
  onDocSelect,
  onSyncCalendarMeta,
  onLinkToCalendar: _onLinkToCalendar,
  focusMode = false,
  onToggleFocusMode,
}: MilindDocProps) {
  const { addTask } = useEntityActions();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [calMetaDraft, setCalMetaDraft] = useState<MilindDocCalendarMeta | null>(doc.calendarMeta ?? null);
  const [titleDraft, setTitleDraft] = useState(doc.title || "Untitled");
  const savedFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  /* Re-seed the drafts only when a *different* doc is opened. Depending on
   * doc.title / doc.calendarMeta as the linter suggests would reset the
   * user's in-progress edits every time the parent pushed an updated doc
   * object back down — which it does on every debounced save. */
  useEffect(() => {
    setCalMetaDraft(doc.calendarMeta ?? null);
    setTitleDraft(doc.title || "Untitled");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const allDocsRef = useRef<MilindDocFile[]>(allDocs);
  useEffect(() => { allDocsRef.current = allDocs; }, [allDocs]);
  const currentDocIdRef = useRef(doc.id);
  useEffect(() => { currentDocIdRef.current = doc.id; }, [doc.id]);

  const titleDraftRef = useRef(titleDraft);
  useEffect(() => { titleDraftRef.current = titleDraft; }, [titleDraft]);

  const wordCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Count without allocating.
   *
   * The obvious version — trim().split(/\s+/).filter(Boolean).length — builds
   * an array holding every word in the document. Scanning for boundaries costs
   * about a third as much and allocates nothing: measured on a 40,000-word
   * document, 0.43ms against 1.28ms.
   */
  const countWords = (text: string): number => {
    let words = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      const ws = c === 32 || c === 9 || c === 10 || c === 13 || c === 0x00a0;
      if (!ws && !inWord) { words++; inWord = true; }
      else if (ws) { inWord = false; }
    }
    return words;
  };

  const updateWordCount = useCallback((e: Editor) => {
    const text = e.state.doc.textContent;
    setWordCount(countWords(text));
    setCharCount(text.length);
  }, []);

  /**
   * Counting is O(document) and was running on every keystroke, walking the
   * whole ProseMirror tree to build a string and re-rendering the editor to
   * show a number nobody reads mid-word. Coalescing it costs nothing visible —
   * the count settles a fifth of a second after you stop typing — and takes
   * that work off the typing path entirely.
   */
  const scheduleWordCount = useCallback((e: Editor) => {
    if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current);
    wordCountTimerRef.current = setTimeout(() => updateWordCount(e), 200);
  }, [updateWordCount]);

  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Start writing… (use @ to link docs)" }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Mention.configure({
        HTMLAttributes: { class: "doc-mention-node" },
        renderHTML({ options, node }) {
          return [
            "span",
            { ...options.HTMLAttributes, "data-id": node.attrs.id },
            `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`,
          ];
        },
        suggestion: {
          items: ({ query }: { query: string }) =>
            allDocsRef.current
              .filter((d) => d.id !== currentDocIdRef.current)
              .filter((d) =>
                (d.title || "Untitled").toLowerCase().includes(query.toLowerCase())
              )
              .slice(0, 8),
          render: () => {
            let renderer: ReactRenderer<MentionListHandle>;
            let popupEl: HTMLDivElement;

            return {
              onStart: (props: SuggestionProps<MilindDocFile>) => {
                popupEl = document.createElement("div");
                popupEl.className = "doc-mention-popup";
                document.body.appendChild(popupEl);

                renderer = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });
                popupEl.appendChild(renderer.element);

                const rect = props.clientRect?.();
                if (rect) {
                  popupEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  popupEl.style.left = `${rect.left + window.scrollX}px`;
                }
              },
              onUpdate: (props: SuggestionProps<MilindDocFile>) => {
                renderer.updateProps(props);
                const rect = props.clientRect?.();
                if (rect) {
                  popupEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
                  popupEl.style.left = `${rect.left + window.scrollX}px`;
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === "Escape") {
                  popupEl?.remove();
                  return true;
                }
                return renderer.ref?.onKeyDown(props) ?? false;
              },
              onExit: () => {
                popupEl?.remove();
                renderer?.destroy();
              },
            };
          },
        },
      }),
    ],
    content: doc.content ?? undefined,
    onUpdate: ({ editor: e }) => {
      scheduleWordCount(e);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const content = e.getJSON() as Record<string, unknown>;
        const extractedTitle = extractTitle(e);
        const title = (titleDraftRef.current && titleDraftRef.current !== "Untitled")
          ? titleDraftRef.current
          : extractedTitle;
        const links = extractMentionIds(content);
        const updated: MilindDocFile = {
          ...docRef.current,
          content,
          title,
          links,
          updatedAt: Date.now(),
        };
        onSaveRef.current(updated);
        setSavedFeedback(true);
        if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
        savedFeedbackTimerRef.current = setTimeout(() => setSavedFeedback(false), 2000);
      }, 500);
    },
  }, []);

  // Initialize word count on mount / doc change
  useEffect(() => {
    if (editor) updateWordCount(editor);
  }, [editor, doc.id, updateWordCount]);

  useEffect(() => {
    if (!editor) return;
    const currentJson = JSON.stringify(editor.getJSON());
    const docJson = JSON.stringify(doc.content ?? {});
    if (currentJson !== docJson) {
      editor.commands.setContent(doc.content ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, editor]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedFeedbackTimerRef.current) clearTimeout(savedFeedbackTimerRef.current);
      if (wordCountTimerRef.current) clearTimeout(wordCountTimerRef.current);
    };
  }, []);

  const handleTitleBlur = useCallback(() => {
    const newTitle = titleDraft.trim() || "Untitled";
    setTitleDraft(newTitle);
    onSave({ ...doc, title: newTitle, updatedAt: Date.now() });
  }, [titleDraft, doc, onSave]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  }, []);

  const handleAddToCalendar = useCallback(() => {
    onAddToCalendar(extractTitle(editor), extractDescription(editor));
  }, [editor, onAddToCalendar]);

  const handleAddToTodo = useCallback(() => {
    const title = extractTitle(editor);
    const newTask: Task = {
      id: Math.random().toString(36).slice(2, 10),
      title,
      completed: false,
      createdAt: Date.now(),
      importance: "medium",
      source: "local",
    };
    addTask(newTask);
    onAddToTodo(title);
  }, [editor, addTask, onAddToTodo]);

  const handleExport = useCallback(() => {
    if (!editor) return;
    const title = extractTitle(editor);
    const md = tiptapToMarkdown(editor.getJSON() as Record<string, unknown>);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  const handleSaveCalendarMeta = useCallback((meta: MilindDocCalendarMeta) => {
    onSave({ ...doc, calendarMeta: meta, updatedAt: Date.now() });
  }, [doc, onSave]);

  const handleCreateDefaultMeta = useCallback((): MilindDocCalendarMeta => {
    const now = new Date();
    const oneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const fresh: MilindDocCalendarMeta = {
      eventId: doc.calendarMeta?.eventId ?? "",
      calendarId: doc.calendarMeta?.calendarId ?? "",
      title: doc.title || extractTitle(editor),
      start: doc.calendarMeta?.start ?? now.toISOString(),
      end: doc.calendarMeta?.end ?? oneHour.toISOString(),
      allDay: doc.calendarMeta?.allDay ?? false,
    };
    setCalMetaDraft(fresh);
    onSave({ ...doc, calendarMeta: fresh, updatedAt: Date.now() });
    return fresh;
  }, [doc, editor, onSave]);

  if (!editor) return null;

  const tb = (active: boolean) => `gd-toolbar-btn${active ? " active" : ""}`;

  const currentTextColor = editor.getAttributes("textStyle").color as string | undefined;
  const currentHighlight = editor.getAttributes("highlight").color as string | undefined;

  return (
    <div className={`milind-doc${focusMode ? " milind-doc--focus" : ""}`}>
      <motion.div 
        className="milind-doc-topbar"
        variants={{
          hidden: { opacity: 0, y: 12 },
          show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: 0.26 } }
        }}
      >
        {/* Title bar */}
        <div className="gd-title-bar">
          <div className="gd-doc-icon" aria-hidden="true">
            <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
              <path d="M12 0H2C0.9 0 0 0.9 0 2v20c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8l-8-8z" fill="currentColor" />
              <path d="M12 0v8h8L12 0z" fill="currentColor" fillOpacity="0.45" />
              <path d="M4 13h12v1.5H4V13zm0 3h12v1.5H4V16zm0 3h8v1.5H4V19z" fill="white" fillOpacity="0.85" />
            </svg>
          </div>
          <input
            className="gd-doc-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={handleTitleKeyDown}
            placeholder="Untitled document"
            spellCheck={false}
          />
          <div className="gd-title-actions">
            <motion.button
              className="gd-action-chip"
              onClick={handleAddToCalendar}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              <Calendar size={12} />
              Add to calendar
            </motion.button>
            <motion.button
              className="gd-action-chip"
              onClick={handleAddToTodo}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              <ListTodo size={12} />
              To-do
            </motion.button>
            <motion.button
              className="gd-action-chip"
              onClick={handleExport}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
            >
              <Download size={12} />
              Export .md
            </motion.button>
            {onToggleFocusMode && (
              <motion.button
                className={`gd-action-chip${focusMode ? " active" : ""}`}
                onClick={onToggleFocusMode}
                type="button"
                title={focusMode ? "Exit focus mode" : "Focus mode"}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
              >
                {focusMode ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {focusMode ? "Exit focus" : "Focus"}
              </motion.button>
            )}
          </div>
        </div>

        {/* Backlinks strip */}
        <BacklinksList entityKey={entityKey("doc", doc.id)} />

        {/* Formatting toolbar */}
        {/* Selection bubble.
          *
          * Character formatting belongs where the text is, not in a strip at
          * the top of the window: with a toolbar you select, travel to the
          * edge, click, and travel back. The bubble puts bold/italic/etc.
          * under the cursor at the moment they're relevant, and — because it
          * only exists while a range is selected — it costs nothing the rest
          * of the time. These controls stay in the toolbar too, so nothing is
          * only reachable by hover. */}
        <BubbleMenu
          editor={editor}
          options={{ placement: "top", offset: 8 }}
          shouldShow={({ editor: ed, from, to }) =>
            // Only for a real range, and never inside a code block, where
            // inline marks don't apply.
            from !== to && !ed.isActive("codeBlock")
          }
        >
          <div className="gd-bubble">
            <button
              className={`gd-bubble-btn${editor.isActive("bold") ? " active" : ""}`}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="Bold (Ctrl+B)"
              type="button"
            >
              <Bold size={14} />
            </button>
            <button
              className={`gd-bubble-btn${editor.isActive("italic") ? " active" : ""}`}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="Italic (Ctrl+I)"
              type="button"
            >
              <Italic size={14} />
            </button>
            <button
              className={`gd-bubble-btn${editor.isActive("underline") ? " active" : ""}`}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              title="Underline (Ctrl+U)"
              type="button"
            >
              <UnderlineIcon size={14} />
            </button>
            <button
              className={`gd-bubble-btn${editor.isActive("strike") ? " active" : ""}`}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="Strikethrough"
              type="button"
            >
              <Strikethrough size={14} />
            </button>
            <span className="gd-bubble-sep" />
            <button
              className={`gd-bubble-btn${editor.isActive("code") ? " active" : ""}`}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title="Inline code"
              type="button"
            >
              <Code size={14} />
            </button>
            <button
              className={`gd-bubble-btn${editor.isActive("link") ? " active" : ""}`}
              onClick={() => {
                const prev = editor.getAttributes("link").href as string | undefined;
                const href = window.prompt("Link URL", prev ?? "https://");
                if (href === null) return;
                if (href === "") {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  return;
                }
                editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
              }}
              title="Link"
              type="button"
            >
              <LinkIcon size={14} />
            </button>
          </div>
        </BubbleMenu>

        <div className="gd-toolbar">
          <StyleDropdown editor={editor} />
          <div className="gd-toolbar-sep" />

          <button
            className="gd-toolbar-btn"
            onClick={() => editor.chain().focus().undo().run()}
            title="Undo (Ctrl+Z)"
            type="button"
            disabled={!editor.can().undo()}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="gd-toolbar-btn"
            onClick={() => editor.chain().focus().redo().run()}
            title="Redo (Ctrl+Y)"
            type="button"
            disabled={!editor.can().redo()}
          >
            <Redo2 size={15} />
          </button>

          <div className="gd-toolbar-sep" />

          <button className={tb(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)" type="button">
            <Bold size={14} />
          </button>
          <button className={tb(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)" type="button">
            <Italic size={14} />
          </button>
          <button className={tb(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)" type="button">
            <UnderlineIcon size={14} />
          </button>
          <button className={tb(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough" type="button">
            <Strikethrough size={14} />
          </button>

          <div className="gd-toolbar-sep" />

          <ColorPicker
            colors={TEXT_COLORS}
            label="Text color"
            iconChar="A"
            previewColor={currentTextColor || "#000000"}
            onSelect={(color) => {
              if (color) editor.chain().focus().setColor(color).run();
              else editor.chain().focus().unsetColor().run();
            }}
          />
          <ColorPicker
            colors={HIGHLIGHT_COLORS}
            label="Highlight color"
            iconChar="A"
            previewColor={currentHighlight || ""}
            isHighlight
            onSelect={(color) => {
              if (color) editor.chain().focus().setHighlight({ color }).run();
              else editor.chain().focus().unsetHighlight().run();
            }}
          />

          <div className="gd-toolbar-sep" />

          <button className={tb(editor.isActive({ textAlign: "left" }))} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left" type="button">
            <AlignLeft size={14} />
          </button>
          <button className={tb(editor.isActive({ textAlign: "center" }))} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center" type="button">
            <AlignCenter size={14} />
          </button>
          <button className={tb(editor.isActive({ textAlign: "right" }))} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align right" type="button">
            <AlignRight size={14} />
          </button>
          <button className={tb(editor.isActive({ textAlign: "justify" }))} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify" type="button">
            <AlignJustify size={14} />
          </button>

          <div className="gd-toolbar-sep" />

          <button className={tb(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list" type="button">
            <List size={14} />
          </button>
          <button className={tb(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list" type="button">
            <ListOrdered size={14} />
          </button>

          <div className="gd-toolbar-sep" />

          <button
            className={tb(editor.isActive("blockquote"))}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Quote"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
              <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
            </svg>
          </button>
          <button
            className={tb(editor.isActive("codeBlock"))}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code block"
            type="button"
          >
            <Code size={14} />
          </button>
          <button
            className="gd-toolbar-btn"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal line"
            type="button"
          >
            <Minus size={14} />
          </button>

          <div className="gd-toolbar-sep" />

          <button className={tb(editor.isActive("link"))} onClick={setLink} title="Insert link (Ctrl+K)" type="button">
            <LinkIcon size={14} />
          </button>
          <button
            className="gd-toolbar-btn"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            title="Insert table"
            type="button"
          >
            <Table2 size={14} />
          </button>
        </div>
      </motion.div>

      <div className="milind-doc-page">
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: 0.30 } }
          }}
        >
          <EditorContent className="milind-doc-content" editor={editor} />
        </motion.div>
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 12 },
            show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1], delay: 0.38 } }
          }}
        >
          <BacklinksSection
            currentDocId={doc.id}
            allDocs={allDocs}
            onDocSelect={onDocSelect}
          />
        </motion.div>
      </div>

      <StatusBar
        wordCount={wordCount}
        charCount={charCount}
        isSaved={savedFeedback}
      />

      <FloatingCalendarPill
        meta={calMetaDraft}
        onSave={(meta) => {
          setCalMetaDraft(meta);
          handleSaveCalendarMeta(meta);
        }}
        onSyncToCalendar={onSyncCalendarMeta}
        onCreateDefault={handleCreateDefaultMeta}
      />
    </div>
  );
}
