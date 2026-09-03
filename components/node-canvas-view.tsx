"use client";

import { AnimatePresence, animate, motion, useMotionValue, useAnimation, useDragControls, type PanInfo } from "framer-motion";
import { startOfWeek, endOfWeek, addWeeks, format, isSameWeek } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  ListTodo,
  Minimize2,
  StickyNote,
  X,
  Check,
  Pencil,
  Flag,
  Calendar,
  User,
  Paperclip,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { CalendarEvent, CalendarSummary, GoogleEventPayload, MilindDocFile, PanelNote, Task, TaskImportance } from "@/lib/models";
import { CANVAS_PENDING_NOTE_KEY } from "@/lib/models";
import { MilindDoc } from "@/components/milind-doc";
import { useDocs, useEntityActions, useTasks } from "@/components/entity-store-context";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Position {
  x: number;
  y: number;
}

interface MilindNote {
  id: string;
  text: string;
}

interface NodeCanvasViewProps {
  events: CalendarEvent[];
  calendars: CalendarSummary[];
  onSaveEvent: (payload: {
    calendarId: string;
    event: GoogleEventPayload;
    eventId?: string;
  }) => Promise<void>;
  onOpenEvent: (event: CalendarEvent) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CARD_W = 160;
const CARD_H = 72;
const TASK_CARD_W = 140;
const TASK_CARD_H = 60;
const STORAGE_PREFIX = "milindcal.canvas";
const uid = () => Math.random().toString(36).slice(2, 10);

const DOC_NODE_W = 500;
const DOC_NODE_H = 480;

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

const IMPORTANCE_COLORS: Record<TaskImportance, string> = {
  low: "#6b7280",
  medium: "#f59e0b",
  high: "#ef4444",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded – ignore */
  }
}

function weekKey(date: Date) {
  return format(startOfWeek(date, { weekStartsOn: 0 }), "yyyy-MM-dd");
}

function eventKey(e: CalendarEvent) {
  return `${e.calendarId}::${e.id}`;
}

/* ------------------------------------------------------------------ */
/*  Free-floating Task Node                                            */
/* ------------------------------------------------------------------ */

interface TaskNodeProps {
  task: Task;
  initialPos: Position;
  canvasRect: DOMRect | null;
  onLivePosUpdate: (id: string, pos: Position) => void;
  onPositionUpdate: (id: string, pos: Position) => void;
  onAttach: (taskId: string) => void;
  onDetach: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  isAttaching: boolean;
  zIndex: number;
  onBringToFront: (id: string) => void;
}

function TaskNode({
  task,
  initialPos,
  canvasRect,
  onLivePosUpdate,
  onPositionUpdate,
  onAttach,
  onToggle,
  isAttaching,
  zIndex,
  onBringToFront,
}: TaskNodeProps) {
  const x = useMotionValue(initialPos.x);
  const y = useMotionValue(initialPos.y);
  const controls = useAnimation();
  const isDragging = useRef(false);
  const posRef = useRef(initialPos);

  useEffect(() => {
    x.set(initialPos.x);
    y.set(initialPos.y);
    posRef.current = initialPos;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPos.x, initialPos.y]);

  // Only update the live ref (for SVG line tracking) on every frame — no React
  // state or localStorage writes until drag end.
  useEffect(() => {
    const unX = x.on("change", (latest) => {
      posRef.current = { ...posRef.current, x: latest };
      onLivePosUpdate(task.id, posRef.current);
    });
    const unY = y.on("change", (latest) => {
      posRef.current = { ...posRef.current, y: latest };
      onLivePosUpdate(task.id, posRef.current);
    });
    return () => { unX(); unY(); };
  }, [task.id, x, y, onLivePosUpdate]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    isDragging.current = false;
    const curX = x.get();
    const curY = y.get();
    const maxX = canvasRect ? canvasRect.width - TASK_CARD_W : 2000;
    const maxY = canvasRect ? canvasRect.height - TASK_CARD_H : 1200;
    const targetX = Math.max(0, Math.min(maxX, curX + info.velocity.x * 0.18));
    const targetY = Math.max(0, Math.min(maxY, curY + info.velocity.y * 0.18));
    void controls.start({ x: targetX, y: targetY, transition: { type: "tween", duration: 0.6, ease: "easeOut" } });
    // Persist once after the momentum animation settles — not on every frame.
    setTimeout(() => onPositionUpdate(task.id, { x: x.get(), y: y.get() }), 650);
  };

  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (isDragging.current) return;
    if (isAttaching) {
      onAttach(task.id);
      return;
    }
  };

  const color = IMPORTANCE_COLORS[task.importance ?? "medium"];
  const dueDateFormatted = task.dueDate
    ? new Date(task.dueDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <motion.div
      animate={controls}
      className={`task-node-wrapper ${task.completed ? "done" : ""} ${isAttaching ? "attach-mode" : ""}`}
      drag
      dragMomentum={false}
      onClick={handleClick}
      onDragEnd={handleDragEnd}
      onDragStart={() => { isDragging.current = true; onBringToFront(task.id); }}
      style={{ x, y, zIndex, position: "absolute", top: 0, left: 0 }}
      whileHover={{ scale: 1.04 }}
    >
      <div className="task-node-card" style={{ borderLeftColor: color }}>
        <div className="task-node-header">
          <span className="task-node-flag" style={{ color }}>
            <Flag size={10} />
          </span>
          <span className="task-node-title">{task.title}</span>
          <button
            className={`task-node-check ${task.completed ? "done" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
            type="button"
          >
            <Check size={10} />
          </button>
        </div>
        <div className="task-node-meta">
          {dueDateFormatted && (
            <span className="task-node-due">
              <Calendar size={9} /> {dueDateFormatted}
            </span>
          )}
          {task.assigneeEmail && (
            <span className="task-node-assignee" title={task.assigneeEmail}>
              <User size={9} /> {task.assigneeEmail.split("@")[0]}
            </span>
          )}
        </div>
      </div>
      {isAttaching && <div className="milind-link-target-hint">Click to attach</div>}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  CanvasDocNode (floating milindDoc editor)                          */
/* ------------------------------------------------------------------ */

interface CanvasDocNodeProps {
  nodeKey: string;
  doc: MilindDocFile;
  allDocs: MilindDocFile[];
  initialPos: Position;
  canvasRect: DOMRect | null;
  onLivePosUpdate: (key: string, pos: Position) => void;
  onPositionUpdate: (key: string, pos: Position) => void;
  onSaveDoc: (key: string, doc: MilindDocFile) => void;
  onClose: (key: string) => void;
  zIndex: number;
  onBringToFront: (key: string) => void;
}

function CanvasDocNode({
  nodeKey,
  doc,
  allDocs,
  initialPos,
  canvasRect,
  onLivePosUpdate,
  onPositionUpdate,
  onSaveDoc,
  onClose,
  zIndex,
  onBringToFront,
}: CanvasDocNodeProps) {
  const x = useMotionValue(initialPos.x);
  const y = useMotionValue(initialPos.y);
  const dragControls = useDragControls();
  const posRef = useRef(initialPos);
  const [size, setSize] = useState({ w: DOC_NODE_W, h: DOC_NODE_H });

  const startResize = (e: React.PointerEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setSize({
        w: dir.includes("e") ? Math.max(320, startW + dx) : startW,
        h: dir.includes("s") ? Math.max(280, startH + dy) : startH,
      });
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    x.set(initialPos.x);
    y.set(initialPos.y);
    posRef.current = initialPos;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPos.x, initialPos.y]);

  // Live ref update only — no React state or localStorage on every frame.
  useEffect(() => {
    const unX = x.on("change", (latest) => {
      posRef.current = { ...posRef.current, x: latest };
      onLivePosUpdate(nodeKey, posRef.current);
    });
    const unY = y.on("change", (latest) => {
      posRef.current = { ...posRef.current, y: latest };
      onLivePosUpdate(nodeKey, posRef.current);
    });
    return () => { unX(); unY(); };
  }, [nodeKey, x, y, onLivePosUpdate]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const curX = x.get();
    const curY = y.get();
    const maxX = canvasRect ? canvasRect.width - DOC_NODE_W : 2000;
    const maxY = canvasRect ? canvasRect.height - 44 : 1200;
    const targetX = Math.max(0, Math.min(maxX, curX + info.velocity.x * 0.12));
    const targetY = Math.max(0, Math.min(maxY, curY + info.velocity.y * 0.12));
    void animate(x, targetX, { type: "tween", duration: 0.5, ease: "easeOut" });
    void animate(y, targetY, { type: "tween", duration: 0.5, ease: "easeOut" });
    // Persist once after momentum settle.
    setTimeout(() => onPositionUpdate(nodeKey, { x: x.get(), y: y.get() }), 550);
  };

  return (
    <motion.div
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      className="canvas-doc-node"
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      exit={{ scale: 0.05, opacity: 0, rotate: 8, transition: { type: "spring", stiffness: 520, damping: 26 } }}
      initial={{ scale: 0.05, opacity: 0, rotate: -14 }}
      onClick={(e) => e.stopPropagation()}
      onDragEnd={handleDragEnd}
      onDragStart={() => onBringToFront(nodeKey)}
      onPointerDown={() => onBringToFront(nodeKey)}
      style={{ x, y, zIndex, width: size.w, height: size.h, position: "absolute", top: 0, left: 0 }}
      transition={{ type: "spring", stiffness: 520, damping: 24 }}
    >
      {/* Header — drag handle */}
      <div
        className="canvas-doc-header"
        onPointerDown={(e) => dragControls.start(e)}
      >
        <FileText size={13} className="canvas-doc-header-icon" />
        <span className="canvas-doc-title">{doc.title || "Untitled"}</span>
        <div className="canvas-doc-header-actions">
          <button
            className="canvas-doc-btn"
            onClick={() => onClose(nodeKey)}
            title="Back to calendar card"
            type="button"
          >
            <Minimize2 size={11} />
          </button>
          <button
            className="canvas-doc-btn canvas-doc-btn--close"
            onClick={() => onClose(nodeKey)}
            title="Close"
            type="button"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Editor body */}
      <div className="canvas-doc-body">
        <MilindDoc
          allDocs={allDocs}
          doc={doc}
          onAddToCalendar={() => {}}
          onAddToTodo={() => {}}
          onDocSelect={() => {}}
          onSave={(updated) => onSaveDoc(nodeKey, updated)}
          onSyncCalendarMeta={async () => {}}
        />
      </div>

      {/* Resize handles */}
      <div className="canvas-doc-resize-e" onPointerDown={(e) => startResize(e, "e")} />
      <div className="canvas-doc-resize-s" onPointerDown={(e) => startResize(e, "s")} />
      <div className="canvas-doc-resize-se" onPointerDown={(e) => startResize(e, "se")} />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  MilindObject (event card)                                          */
/* ------------------------------------------------------------------ */

interface MilindObjectProps {
  event: CalendarEvent;
  initialPos: Position;
  canvasRect: DOMRect | null;
  onLivePosUpdate: (key: string, pos: Position) => void;
  onPositionUpdate: (key: string, pos: Position) => void;
  onContextMenu: (key: string, pos: Position, screenPos: Position) => void;
  isLinking: boolean;
  onLinkTarget: (key: string) => void;
  attachedTasks: Task[];
  notes: MilindNote[];
  expanded: boolean;
  onDetachTask: (taskId: string) => void;
  onToggleAttachedTask: (taskId: string) => void;
  onDeleteNote: (eventKey: string, noteId: string) => void;
  zIndex: number;
  onBringToFront: (key: string) => void;
  isAttachTarget: boolean;
  onReceiveAttach: (key: string) => void;
}

function MilindObject({
  event,
  initialPos,
  canvasRect,
  onLivePosUpdate,
  onPositionUpdate,
  onContextMenu,
  isLinking,
  onLinkTarget,
  attachedTasks,
  notes,
  expanded,
  onDetachTask,
  onToggleAttachedTask,
  onDeleteNote,
  zIndex,
  onBringToFront,
  isAttachTarget,
  onReceiveAttach,
}: MilindObjectProps) {
  const key = eventKey(event);
  const x = useMotionValue(initialPos.x);
  const y = useMotionValue(initialPos.y);
  const controls = useAnimation();
  const isDragging = useRef(false);
  const posRef = useRef(initialPos);

  useEffect(() => {
    x.set(initialPos.x);
    y.set(initialPos.y);
    posRef.current = initialPos;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPos.x, initialPos.y, x, y]);

  // Live ref update only — keeps SVG lines smooth without React re-renders.
  useEffect(() => {
    const unX = x.on("change", (latest) => {
      posRef.current = { ...posRef.current, x: latest };
      onLivePosUpdate(key, posRef.current);
    });
    const unY = y.on("change", (latest) => {
      posRef.current = { ...posRef.current, y: latest };
      onLivePosUpdate(key, posRef.current);
    });
    return () => { unX(); unY(); };
  }, [key, x, y, onLivePosUpdate]);

  const handleDragStart = () => {
    isDragging.current = true;
    onBringToFront(key);
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    isDragging.current = false;
    const curX = x.get();
    const curY = y.get();
    const maxX = canvasRect ? canvasRect.width - CARD_W : 2000;
    const maxY = canvasRect ? canvasRect.height - CARD_H : 1200;
    const targetX = Math.max(0, Math.min(maxX, curX + info.velocity.x * 0.18));
    const targetY = Math.max(0, Math.min(maxY, curY + info.velocity.y * 0.18));
    void controls.start({ x: targetX, y: targetY, transition: { type: "tween", duration: 0.6, ease: "easeOut" } });
    setTimeout(() => onPositionUpdate(key, { x: x.get(), y: y.get() }), 650);
  };

  const handleClick = (e: ReactMouseEvent) => {
    if (isDragging.current) return;
    if (isLinking) { onLinkTarget(key); return; }
    if (isAttachTarget) { onReceiveAttach(key); return; }
    if ((e.currentTarget as HTMLElement).dataset.pendingAttach === "true") {
      // handled by parent via onReceiveAttach
      return;
    }
    onContextMenu(key, { x: x.get(), y: y.get() }, { x: e.clientX, y: e.clientY });
  };

  const timeStr = event.allDay
    ? "All day"
    : new Date(event.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <motion.div
      animate={controls}
      className={`milind-object-wrapper ${isAttachTarget ? "attach-target" : ""}`}
      drag
      dragMomentum={false}
      onClick={handleClick}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      style={{ x, y, zIndex, position: "absolute", top: 0, left: 0 }}
      whileHover={{ scale: 1.04 }}
    >
      {/* Attached tasks (orbit around card) */}
      {attachedTasks.map((task, i) => {
        const angle = ((Math.PI * 2) / Math.max(attachedTasks.length, 1)) * i - Math.PI / 2;
        const dist = 70 + i * 12;
        const ox = Math.cos(angle) * dist;
        const oy = Math.sin(angle) * dist - 30;
        return (
          <motion.div
            key={task.id}
            animate={{ y: [0, -4, 0, 4, 0], x: [0, 2, 0, -2, 0] }}
            className={`floating-task ${task.completed ? "done" : ""}`}
            onClick={(e) => { e.stopPropagation(); onToggleAttachedTask(task.id); }}
            onDoubleClick={(e) => { e.stopPropagation(); onDetachTask(task.id); }}
            style={{
              position: "absolute",
              left: CARD_W / 2 + ox - 50,
              top: CARD_H / 2 + oy - 12,
              borderLeft: `2px solid ${IMPORTANCE_COLORS[task.importance ?? "medium"]}`,
            }}
            title="Double-click to detach"
            transition={{ repeat: Infinity, duration: 3.5 + i * 0.4, ease: "easeInOut" }}
          >
            {task.completed ? "✓ " : "○ "}
            {task.title}
          </motion.div>
        );
      })}

      {/* Floating notes */}
      {notes.map((note, i) => {
        const angle = ((Math.PI * 2) / Math.max(notes.length, 1)) * i + Math.PI;
        const dist = 85 + i * 14;
        const ox = Math.cos(angle) * dist;
        const oy = Math.sin(angle) * dist;
        return (
          <motion.div
            key={note.id}
            animate={{ y: [0, -3, 0, 3, 0], rotate: [0, 1, 0, -1, 0] }}
            className="floating-note"
            onDoubleClick={(e) => { e.stopPropagation(); onDeleteNote(key, note.id); }}
            style={{ position: "absolute", left: CARD_W / 2 + ox - 50, top: CARD_H / 2 + oy - 16 }}
            transition={{ repeat: Infinity, duration: 4 + i * 0.6, ease: "easeInOut" }}
          >
            {note.text}
          </motion.div>
        );
      })}

      {/* The card itself */}
      <div className="milind-card" style={{ borderLeftColor: event.color }}>
        <span className="milind-time">{timeStr}</span>
        <span className="milind-title">{event.title}</span>
        {expanded && (
          <motion.div
            animate={{ opacity: 1, height: "auto" }}
            className="milind-expanded"
            exit={{ opacity: 0, height: 0 }}
            initial={{ opacity: 0, height: 0 }}
          >
            {event.location && <p className="milind-detail">📍 {event.location}</p>}
            {event.description && (
              <p className="milind-detail">{event.description.slice(0, 120)}</p>
            )}
            {event.attendees.length > 0 && (
              <p className="milind-detail">
                {event.attendees.length} attendee{event.attendees.length > 1 ? "s" : ""}
              </p>
            )}
          </motion.div>
        )}
        {attachedTasks.length > 0 && (
          <span className="milind-task-count">
            <Paperclip size={10} /> {attachedTasks.length}
          </span>
        )}
      </div>

      {(isLinking || isAttachTarget) && (
        <div className="milind-link-target-hint">
          {isAttachTarget ? "Click to attach task" : "Click to link"}
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main canvas                                                        */
/* ------------------------------------------------------------------ */

export function NodeCanvasView({
  events,
  onSaveEvent,
  onOpenEvent,
}: NodeCanvasViewProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  /* Persisted state */
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [notes, setNotes] = useState<Record<string, MilindNote[]>>({});
  const [connections, setConnections] = useState<[string, string][]>([]);

  /* Shared sidebar tasks — sourced from the EntityStore, the single source of
   * truth for tasks across every view (calendar, sidebar, canvas, docs). */
  const sidebarTasks = useTasks();
  const { updateTask, addDoc, updateDoc } = useEntityActions();

  /* Task node positions (for free-floating tasks on canvas) */
  const [taskNodePositions, setTaskNodePositions] = useState<Record<string, Position>>({});

  /* UI state */
  const [contextMenu, setContextMenu] = useState<{ key: string; screen: Position } | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Position>({ x: 0, y: 0 });
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [zIndices, setZIndices] = useState<Record<string, number>>({});
  const zCounter = useRef(1);

  /* Attaching mode: user picks a task then clicks an event to attach */
  const [attachingTaskId, setAttachingTaskId] = useState<string | null>(null);

  /* Inline editors */
  const [noteInput, setNoteInput] = useState<{ key: string; text: string } | null>(null);

  /* Pending note from milindDocs panel */
  const [pendingNote, setPendingNote] = useState<PanelNote | null>(null);

  /* Canvas doc nodes — floating milindDoc editors */
  const [canvasDocNodes, setCanvasDocNodes] = useState<Record<string, { doc: MilindDocFile; pos: Position }>>({});
  const [convertedEventKeys, setConvertedEventKeys] = useState<Set<string>>(new Set());
  /* The docs library is the EntityStore's, not a private copy. This component
   * used to hydrate `libraryDocs` from localStorage once on mount and write
   * back to it directly, which meant canvas-authored docs never reached
   * milindDrive and Drive-sourced docs never showed up in canvas @mentions.
   * Reading the store keeps every view on one source of truth. */
  const libraryDocs = useDocs();

  useEffect(() => {
    const raw = localStorage.getItem(CANVAS_PENDING_NOTE_KEY);
    if (raw) {
      try {
        const note = JSON.parse(raw) as PanelNote;
        setPendingNote(note);
        localStorage.removeItem(CANVAS_PENDING_NOTE_KEY);
      } catch { /* ignore */ }
    }
  }, []);

  /* Mirror of the store's docs for use inside callbacks that must see the
   * latest library without being re-created (and re-registered) on every
   * docs change. */
  const docsRef = useRef(libraryDocs);
  useEffect(() => { docsRef.current = libraryDocs; }, [libraryDocs]);

  /* Live position tracking for SVG (ref, no re-renders) */
  const livePosRef = useRef<Record<string, Position>>({});
  const rafRef = useRef(0);
  // Drives the connection-line sync loop. The loop only runs while positions
  // are actively changing (a drag/animation in flight); once a frame passes
  // with nothing dirty it stops, so an idle canvas costs zero rAF time.
  const linesDirtyRef = useRef(false);
  const lineLoopRunningRef = useRef(false);

  /* Current week range */
  const currentWeekStart = useMemo(
    () => startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 0 }),
    [weekOffset]
  );
  const currentWeekEnd = useMemo(() => endOfWeek(currentWeekStart, { weekStartsOn: 0 }), [currentWeekStart]);
  const wk = weekKey(currentWeekStart);

  const isCurrentWeek = isSameWeek(new Date(), currentWeekStart, { weekStartsOn: 0 });

  /* Filter events for current week */
  const weekEvents = useMemo(() => {
    return events.filter((e) => {
      const s = new Date(e.start);
      return s >= currentWeekStart && s <= currentWeekEnd;
    });
  }, [events, currentWeekStart, currentWeekEnd]);

  /* Load persisted data when week changes */
  useEffect(() => {
    setPositions(loadJson(`${STORAGE_PREFIX}.pos.${wk}`, {}));
    setNotes(loadJson(`${STORAGE_PREFIX}.notes`, {}));
    setConnections(loadJson(`${STORAGE_PREFIX}.conn.${wk}`, []));
    setContextMenu(null);
    setLinkingFrom(null);
    setExpandedCards(new Set());
    setAttachingTaskId(null);
  }, [wk]);

  /* Measure canvas */
  useEffect(() => {
    const measure = () => {
      if (canvasRef.current) setCanvasRect(canvasRef.current.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /* Assign random initial positions to new events */
  useEffect(() => {
    if (!canvasRect) return;
    setPositions((prev) => {
      const next = { ...prev };
      let changed = false;
      weekEvents.forEach((e) => {
        const k = eventKey(e);
        if (!next[k]) {
          next[k] = {
            x: 40 + Math.random() * (canvasRect.width - CARD_W - 80),
            y: 40 + Math.random() * (canvasRect.height - CARD_H - 80),
          };
          changed = true;
        }
      });
      if (changed) saveJson(`${STORAGE_PREFIX}.pos.${wk}`, next);
      return changed ? next : prev;
    });
  }, [weekEvents, canvasRect, wk]);

  /* A task carrying a start *is* a calendar entry, so it follows the canvas
   * week exactly as an event does. A task with no start isn't scheduled, has
   * no week to belong to, and stays visible on every week. */
  const inCurrentWeek = useCallback(
    (t: Task) => {
      if (!t.start) return true;
      const s = new Date(t.start);
      return s >= currentWeekStart && s <= currentWeekEnd;
    },
    [currentWeekStart, currentWeekEnd],
  );

  /* Assign random positions to new free-floating tasks */
  useEffect(() => {
    if (!canvasRect) return;
    // Same predicate as the render below — seeding positions for nodes that
    // aren't shown this week would be wasted work and leak across weeks.
    const freeTasks = sidebarTasks.filter(
      (t) => !t.attachedToEventKey && !t.completed && inCurrentWeek(t),
    );
    setTaskNodePositions((prev) => {
      const next = { ...prev };
      let changed = false;
      freeTasks.forEach((t) => {
        if (!next[t.id] && !t.canvasPos) {
          next[t.id] = {
            x: 40 + Math.random() * (canvasRect.width - TASK_CARD_W - 80),
            y: 40 + Math.random() * (canvasRect.height - TASK_CARD_H - 80),
          };
          changed = true;
        } else if (!next[t.id] && t.canvasPos) {
          next[t.id] = t.canvasPos;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sidebarTasks, canvasRect, inCurrentWeek]);

  /* One pass: write current live positions into the SVG connection lines. */
  const syncLines = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const lines = svg.querySelectorAll<SVGLineElement>(".conn-line");
    lines.forEach((line) => {
      const from = line.dataset.from!;
      const to = line.dataset.to!;
      const fp = livePosRef.current[from];
      const tp = livePosRef.current[to];
      if (fp && tp) {
        line.setAttribute("x1", String(fp.x + CARD_W / 2));
        line.setAttribute("y1", String(fp.y + CARD_H / 2));
        line.setAttribute("x2", String(tp.x + CARD_W / 2));
        line.setAttribute("y2", String(tp.y + CARD_H / 2));
      }
    });
  }, []);

  /* Start the rAF sync loop if it isn't already running. The loop self-stops
   * once a frame elapses with no new position changes, so it costs nothing
   * while the canvas is idle (previously it ran at 60fps forever). */
  const kickLineLoop = useCallback(() => {
    linesDirtyRef.current = true;
    if (lineLoopRunningRef.current) return;
    lineLoopRunningRef.current = true;
    const loop = () => {
      const wasDirty = linesDirtyRef.current;
      linesDirtyRef.current = false;
      syncLines();
      if (wasDirty) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        lineLoopRunningRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [syncLines]);

  /* Live position update — ref only, no React re-render (called on every drag frame) */
  const handleLivePosUpdate = useCallback((key: string, pos: Position) => {
    livePosRef.current[key] = pos;
    kickLineLoop();
  }, [kickLineLoop]);

  /* Persist positions — called once on drag end */
  const handlePositionUpdate = useCallback(
    (key: string, pos: Position) => {
      livePosRef.current[key] = pos;
      setPositions((prev) => {
        const updated = { ...prev, [key]: pos };
        saveJson(`${STORAGE_PREFIX}.pos.${wk}`, updated);
        return updated;
      });
    },
    [wk]
  );

  /* Live task position — ref only, no React re-render */
  const handleLiveTaskPosUpdate = useCallback((id: string, pos: Position) => {
    livePosRef.current[id] = pos;
    kickLineLoop();
  }, [kickLineLoop]);

  /* Persist task position — called once on drag end */
  const handleTaskPositionUpdate = useCallback((id: string, pos: Position) => {
    livePosRef.current[id] = pos;
    setTaskNodePositions((prev) => ({ ...prev, [id]: pos }));
    updateTask(id, { canvasPos: pos });
  }, [updateTask]);

  /* Position the connection lines once whenever the connection set changes.
   * Continuous updates during a drag are handled by kickLineLoop, which only
   * runs while positions are actually moving. */
  useEffect(() => {
    kickLineLoop();
    return () => {
      cancelAnimationFrame(rafRef.current);
      lineLoopRunningRef.current = false;
    };
  }, [connections, kickLineLoop]);

  /* Track mouse for linking line */
  useEffect(() => {
    if (!linkingFrom) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [linkingFrom]);

  /* Escape cancels modes */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLinkingFrom(null);
        setContextMenu(null);
        setNoteInput(null);
        setAttachingTaskId(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /* Close context menu on canvas click */
  const handleCanvasClick = () => {
    if (contextMenu) setContextMenu(null);
    if (noteInput) setNoteInput(null);
  };

  /* Bring card to front */
  const bringToFront = useCallback((key: string) => {
    zCounter.current += 1;
    setZIndices((prev) => ({ ...prev, [key]: zCounter.current }));
  }, []);

  /* Context menu actions */
  const handleContextMenu = useCallback(
    (key: string, _pos: Position, screenPos: Position) => {
      if (attachingTaskId) return; // don't show context menu when in attach mode
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      setContextMenu({ key, screen: { x: screenPos.x - rect.left, y: screenPos.y - rect.top } });
    },
    [attachingTaskId]
  );

  const startLinking = () => {
    if (!contextMenu) return;
    setLinkingFrom(contextMenu.key);
    setContextMenu(null);
  };

  const handleLinkTarget = useCallback(
    (targetKey: string) => {
      if (!linkingFrom || targetKey === linkingFrom) return;
      const exists = connections.some(
        ([a, b]) => (a === linkingFrom && b === targetKey) || (a === targetKey && b === linkingFrom)
      );
      if (!exists) {
        const updated = [...connections, [linkingFrom, targetKey] as [string, string]];
        setConnections(updated);
        saveJson(`${STORAGE_PREFIX}.conn.${wk}`, updated);

        const fromEvent = weekEvents.find((e) => eventKey(e) === linkingFrom);
        const toEvent = weekEvents.find((e) => eventKey(e) === targetKey);
        if (fromEvent && toEvent) {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          void onSaveEvent({
            calendarId: fromEvent.calendarId,
            eventId: fromEvent.id,
            event: {
              title: fromEvent.title,
              description: fromEvent.description + `\n🔗 Linked to: ${toEvent.title}`,
              location: fromEvent.location,
              start: fromEvent.start,
              end: fromEvent.end,
              allDay: fromEvent.allDay,
              attendees: fromEvent.attendees,
              recurrence: fromEvent.recurrence,
              reminders: fromEvent.reminders,
              eventType: fromEvent.eventType,
              colorId: fromEvent.colorId,
              timeZone: tz,
            },
          });
          void onSaveEvent({
            calendarId: toEvent.calendarId,
            eventId: toEvent.id,
            event: {
              title: toEvent.title,
              description: toEvent.description + `\n🔗 Linked to: ${fromEvent.title}`,
              location: toEvent.location,
              start: toEvent.start,
              end: toEvent.end,
              allDay: toEvent.allDay,
              attendees: toEvent.attendees,
              recurrence: toEvent.recurrence,
              reminders: toEvent.reminders,
              eventType: toEvent.eventType,
              colorId: toEvent.colorId,
              timeZone: tz,
            },
          });
        }
      }
      setLinkingFrom(null);
    },
    [linkingFrom, connections, wk, weekEvents, onSaveEvent]
  );

  /* Attach task to event */
  const handleReceiveAttach = useCallback(
    (targetEventKey: string) => {
      if (!attachingTaskId) return;
      updateTask(attachingTaskId, { attachedToEventKey: targetEventKey, canvasPos: undefined });
      setAttachingTaskId(null);
    },
    [attachingTaskId, updateTask]
  );

  /* Attach pending note (from milindDocs panel) to an event */
  const handleAttachPendingNote = useCallback(
    (targetEventKey: string) => {
      if (!pendingNote) return;
      const newNote: MilindNote = { id: pendingNote.id, text: pendingNote.text };
      setNotes((prev) => {
        const updated = { ...prev, [targetEventKey]: [...(prev[targetEventKey] || []), newNote] };
        saveJson(`${STORAGE_PREFIX}.notes`, updated);
        return updated;
      });
      setPendingNote(null);
    },
    [pendingNote]
  );

  /* Detach task from event (back to free-floating) */
  const handleDetachTask = useCallback(
    (taskId: string) => {
      updateTask(taskId, { attachedToEventKey: undefined });
    },
    [updateTask]
  );

  /* Toggle attached task */
  const handleToggleAttachedTask = useCallback(
    (taskId: string) => {
      const current = sidebarTasks.find((t) => t.id === taskId);
      if (!current) return;
      updateTask(taskId, { completed: !current.completed });
    },
    [sidebarTasks, updateTask]
  );

  /* Toggle free-floating task */
  const handleToggleFloatingTask = useCallback(
    (taskId: string) => {
      const current = sidebarTasks.find((t) => t.id === taskId);
      if (!current) return;
      updateTask(taskId, { completed: !current.completed });
    },
    [sidebarTasks, updateTask]
  );

  /* Note actions */
  const startAddNote = () => {
    if (!contextMenu) return;
    setNoteInput({ key: contextMenu.key, text: "" });
    setContextMenu(null);
  };

  const commitNote = () => {
    if (!noteInput || !noteInput.text.trim()) { setNoteInput(null); return; }
    const k = noteInput.key;
    const newNote: MilindNote = { id: uid(), text: noteInput.text.trim() };
    setNotes((prev) => {
      const updated = { ...prev, [k]: [...(prev[k] || []), newNote] };
      saveJson(`${STORAGE_PREFIX}.notes`, updated);
      return updated;
    });
    setNoteInput(null);
  };

  const deleteNote = useCallback((evKey: string, noteId: string) => {
    setNotes((prev) => {
      const list = (prev[evKey] || []).filter((n) => n.id !== noteId);
      const updated = { ...prev, [evKey]: list };
      saveJson(`${STORAGE_PREFIX}.notes`, updated);
      return updated;
    });
  }, []);

  /* Expand/collapse */
  const toggleExpand = useCallback((key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  /* Open event in editor */
  const openInEditor = () => {
    if (!contextMenu) return;
    const ev = weekEvents.find((e) => eventKey(e) === contextMenu.key);
    if (ev) onOpenEvent(ev);
    setContextMenu(null);
  };

  /* Open event as a floating milindDoc on the canvas */
  const openAsCanvasDoc = () => {
    if (!contextMenu) return;
    const ev = weekEvents.find((e) => eventKey(e) === contextMenu.key);
    if (!ev) return;
    const k = contextMenu.key;
    if (canvasDocNodes[k]) { setContextMenu(null); return; }
    const pos = positions[k] || { x: 100, y: 100 };

    // Reuse an existing doc for this event if the library already has one.
    // `docsRef` mirrors the store so this stays correct even when the click
    // handler was created before the most recent docs update.
    const freshDocs = docsRef.current;
    const existingDoc = freshDocs.find((d) => d.id === `event-doc-${ev.id}`)
      || freshDocs.find((d) => d.calendarMeta?.eventId === ev.id);
    const doc: MilindDocFile = existingDoc
      ? { ...existingDoc, calendarMeta: { ...existingDoc.calendarMeta!, title: ev.title, start: ev.start, end: ev.end, location: ev.location, allDay: ev.allDay } }
      : {
          id: `event-doc-${ev.id}`,
          title: ev.title,
          content: ev.description
            ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: ev.description }] }] }
            : null,
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
        };

    setCanvasDocNodes((prev) => ({ ...prev, [k]: { doc, pos } }));
    setConvertedEventKeys((prev) => new Set([...prev, k]));
    bringToFront(k + ".doc");
    setContextMenu(null);
  };

  const handleSaveCanvasDoc = useCallback((nodeKey: string, updated: MilindDocFile) => {
    setCanvasDocNodes((prev) => {
      if (!prev[nodeKey]) return prev;
      return { ...prev, [nodeKey]: { ...prev[nodeKey], doc: updated } };
    });
    // Persist through the store so the edit reaches milindDrive and every
    // other view, instead of only this tab's localStorage.
    if (docsRef.current.some((d) => d.id === updated.id)) {
      updateDoc(updated.id, updated);
    } else {
      addDoc(updated);
    }
    // Sync content back to Google Calendar event
    if (updated.calendarMeta) {
      const { eventId, calendarId, title, start, end, location, allDay } = updated.calendarMeta;
      const description = tiptapToPlainText(updated.content);
      void onSaveEvent({
        calendarId,
        eventId,
        event: {
          title,
          description,
          location: location ?? "",
          start,
          end,
          allDay,
          attendees: [],
          recurrence: [],
          reminders: { useDefault: true, overrides: [] },
          eventType: "meeting",
          colorId: "9",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    }
  }, [onSaveEvent, addDoc, updateDoc]);

  const handleCloseCanvasDoc = useCallback((nodeKey: string) => {
    setCanvasDocNodes((prev) => {
      const next = { ...prev };
      delete next[nodeKey];
      return next;
    });
    setConvertedEventKeys((prev) => {
      const next = new Set(prev);
      next.delete(nodeKey);
      return next;
    });
  }, []);

  /* Live doc position — ref only, no React re-render */
  const handleDocLivePosUpdate = useCallback((_nodeKey: string, _pos: Position) => {
    // Doc nodes don't feed SVG lines; just a no-op to satisfy the interface.
  }, []);

  /* Persist doc position — called once on drag end */
  const handleDocNodePositionUpdate = useCallback((nodeKey: string, pos: Position) => {
    setCanvasDocNodes((prev) => {
      if (!prev[nodeKey]) return prev;
      return { ...prev, [nodeKey]: { ...prev[nodeKey], pos } };
    });
  }, []);

  /* Hide events that have been opened as canvas doc nodes */
  const visibleWeekEvents = weekEvents.filter((e) => !convertedEventKeys.has(eventKey(e)));

  /* Week label */
  const weekLabel = `${format(currentWeekStart, "MMM d")} – ${format(currentWeekEnd, "MMM d, yyyy")}`;
  const linkSourcePos = linkingFrom ? livePosRef.current[linkingFrom] : null;

  /* Separate tasks: free-floating vs attached.
   *
   * The canvas is scoped to a week, and events were filtered by it while
   * tasks were not — so a task scheduled for Friday still appeared when you
   * paged to next week, sitting alongside events that had correctly gone
   * away. Under the record model a task carrying a start *is* a calendar
   * entry, so it follows the week exactly as an event does. A task with no
   * start isn't scheduled, has no week to belong to, and stays put. */
  const freeTasks = useMemo(
    () => sidebarTasks.filter((t) => !t.attachedToEventKey && !t.completed && inCurrentWeek(t)),
    [sidebarTasks, inCurrentWeek]
  );

  const attachedTasksByEvent = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of sidebarTasks) {
      if (t.attachedToEventKey) {
        if (!map[t.attachedToEventKey]) map[t.attachedToEventKey] = [];
        map[t.attachedToEventKey].push(t);
      }
    }
    return map;
  }, [sidebarTasks]);

  return (
    <div className="node-canvas-container">
      {/* Week nav */}
      <div className="canvas-week-nav">
        <button className="ghost-button" onClick={() => setWeekOffset((w) => w - 1)} type="button">
          <ChevronLeft size={16} /> Prev week
        </button>
        <span className="canvas-week-label">
          {weekLabel}
          {isCurrentWeek && <span className="canvas-current-badge">current</span>}
        </span>
        <button className="ghost-button" onClick={() => setWeekOffset((w) => w + 1)} type="button">
          Next week <ChevronRight size={16} />
        </button>
      </div>

      {/* Canvas */}
      <div
        className={`node-canvas ${linkingFrom ? "linking-mode" : ""} ${attachingTaskId ? "attaching-mode" : ""}`}
        onClick={handleCanvasClick}
        ref={canvasRef}
      >
        {/* SVG connections layer */}
        <svg className="canvas-svg" ref={svgRef}>
          {connections.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              className="conn-line"
              data-from={from}
              data-to={to}
              stroke="rgba(127, 29, 29, 0.35)"
              strokeDasharray="6 4"
              strokeWidth={2}
              x1={0}
              x2={0}
              y1={0}
              y2={0}
            />
          ))}
          {linkingFrom && linkSourcePos && (
            <line
              stroke="rgba(127, 29, 29, 0.5)"
              strokeDasharray="4 4"
              strokeWidth={2}
              x1={linkSourcePos.x + CARD_W / 2}
              x2={mousePos.x}
              y1={linkSourcePos.y + CARD_H / 2}
              y2={mousePos.y}
            />
          )}
        </svg>

        {/* Event objects */}
        {visibleWeekEvents.map((event) => {
          const k = eventKey(event);
          const pos = positions[k] || { x: 100, y: 100 };
          livePosRef.current[k] = pos;
          return (
            <MilindObject
              key={k}
              attachedTasks={attachedTasksByEvent[k] || []}
              canvasRect={canvasRect}
              event={event}
              expanded={expandedCards.has(k)}
              initialPos={pos}
              isAttachTarget={!!attachingTaskId || !!pendingNote}
              isLinking={!!linkingFrom}
              notes={notes[k] || []}
              onBringToFront={bringToFront}
              onContextMenu={(key, pos, screenPos) => pendingNote ? handleAttachPendingNote(key) : handleContextMenu(key, pos, screenPos)}
              onDeleteNote={deleteNote}
              onDetachTask={handleDetachTask}
              onLinkTarget={handleLinkTarget}
              onLivePosUpdate={handleLivePosUpdate}
              onPositionUpdate={handlePositionUpdate}
              onReceiveAttach={!!pendingNote ? handleAttachPendingNote : handleReceiveAttach}
              onToggleAttachedTask={handleToggleAttachedTask}
              zIndex={zIndices[k] || 1}
            />
          );
        })}

        {/* Free-floating task nodes from sidebar */}
        {freeTasks.map((task) => {
          const pos = taskNodePositions[task.id] || { x: 60, y: 60 };
          return (
            <TaskNode
              key={task.id}
              canvasRect={canvasRect}
              initialPos={pos}
              isAttaching={attachingTaskId === task.id}
              onAttach={(taskId) => setAttachingTaskId(taskId)}
              onBringToFront={bringToFront}
              onDetach={handleDetachTask}
              onLivePosUpdate={handleLiveTaskPosUpdate}
              onPositionUpdate={handleTaskPositionUpdate}
              onToggle={handleToggleFloatingTask}
              task={task}
              zIndex={zIndices[task.id] || 1}
            />
          );
        })}

        {/* Empty state */}
        {visibleWeekEvents.length === 0 && freeTasks.length === 0 && (
          <div className="canvas-empty">
            <p>No events this week</p>
            <p className="canvas-empty-hint">Navigate to a week with events or create new ones</p>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="milind-context-menu"
            initial={{ opacity: 0, scale: 0.9 }}
            style={{ left: contextMenu.screen.x, top: contextMenu.screen.y }}
            transition={{ duration: 0.12 }}
          >
            <button onClick={startLinking} type="button">
              <Link2 size={14} /> Draw link
            </button>
            <button onClick={startAddNote} type="button">
              <StickyNote size={14} /> Add note
            </button>
            <button onClick={() => { toggleExpand(contextMenu.key); setContextMenu(null); }} type="button">
              <Pencil size={14} /> {expandedCards.has(contextMenu.key) ? "Collapse" : "Expand"}
            </button>
            <button onClick={openAsCanvasDoc} type="button">
              <FileText size={14} /> Edit as milindDoc
            </button>
            <button onClick={openInEditor} type="button">
              <Pencil size={14} /> Edit event
            </button>
            <button onClick={() => setContextMenu(null)} type="button">
              <X size={14} /> Cancel
            </button>
          </motion.div>
        )}

        {/* Note input popover */}
        {noteInput && (
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className="milind-inline-input note-input"
            initial={{ opacity: 0, x: -8 }}
            style={{
              left: (positions[noteInput.key]?.x || 100) + CARD_W + 10,
              top: (positions[noteInput.key]?.y || 100) + 40,
            }}
          >
            <textarea
              autoFocus
              onChange={(e) => setNoteInput({ ...noteInput, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitNote(); }
                if (e.key === "Escape") setNoteInput(null);
              }}
              placeholder="Write a note..."
              rows={3}
              value={noteInput.text}
            />
            <button onClick={commitNote} type="button">
              <Check size={14} />
            </button>
          </motion.div>
        )}

        {/* Floating milindDoc nodes */}
        <AnimatePresence>
          {Object.entries(canvasDocNodes).map(([k, { doc, pos }]) => (
            <CanvasDocNode
              key={k}
              allDocs={libraryDocs}
              canvasRect={canvasRect}
              doc={doc}
              initialPos={pos}
              nodeKey={k}
              onBringToFront={(key) => bringToFront(key)}
              onClose={handleCloseCanvasDoc}
              onLivePosUpdate={handleDocLivePosUpdate}
              onPositionUpdate={handleDocNodePositionUpdate}
              onSaveDoc={handleSaveCanvasDoc}
              zIndex={(zIndices[k + ".doc"] || 0) + 500}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Mode indicators */}
      {linkingFrom && (
        <div className="linking-indicator">
          Click another event to create a link — press Escape to cancel
        </div>
      )}
      {attachingTaskId && (
        <div className="linking-indicator attaching-indicator">
          <ListTodo size={14} />
          Click an event to attach the task — press Escape to cancel
        </div>
      )}
      {pendingNote && (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="canvas-pending-note-bar"
          initial={{ opacity: 0, y: -16 }}
          transition={{ type: "spring", stiffness: 420, damping: 26 }}
        >
          <StickyNote size={13} />
          <span>
            Click an event to attach note: <strong>&ldquo;{pendingNote.text.slice(0, 40)}{pendingNote.text.length > 40 ? "…" : ""}&rdquo;</strong>
          </span>
          <button onClick={() => setPendingNote(null)} title="Cancel" type="button">
            <X size={13} />
          </button>
        </motion.div>
      )}
    </div>
  );
}
