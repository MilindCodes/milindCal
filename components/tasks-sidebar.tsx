"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlignLeft, Archive, Calendar, Check, ChevronDown, ChevronLeft,
  Clock, ExternalLink, Flag, LayoutGrid, Link2, List, Mail, Maximize2, PenLine, Plus, RefreshCw,
  Reply, ReplyAll, Send, Trash2, Unlink, User, X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { BacklinksList } from "@/components/backlinks-list";
import { useEntityActions, useTasks } from "@/components/entity-store-context";
import { useUniversalDraggable, useUniversalDroppable } from "@/components/universal-drag-layer";
import { entityKey, payloadFromTask } from "@/lib/entity-store";
import type {
  GmailContact, GmailMessageDetail, GmailMessageSummary, KanbanColumn, Task, TaskImportance,
} from "@/lib/models";
import { DEFAULT_KANBAN_COLUMNS, KANBAN_COLUMNS_KEY } from "@/lib/models";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const IMPORTANCE_LABELS: Record<TaskImportance, string> = {
  low: "Low", medium: "Med", high: "High",
};

const IMPORTANCE_COLORS: Record<TaskImportance, string> = {
  low: "#6b7280", medium: "#f59e0b", high: "#ef4444",
};

type BoardView = "list" | "kanban" | "timeline";

const BOARD_VIEWS: BoardView[] = ["list", "kanban", "timeline"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function resolveColumnId(task: Task, columns: KanbanColumn[]): string {
  if (task.completed) return "done";
  if (task.columnId && columns.some((c) => c.id === task.columnId)) return task.columnId;
  const importance = task.importance ?? "medium";
  if (columns.some((c) => c.id === importance)) return importance;
  const nonDone = columns.find((c) => c.id !== "done");
  return nonDone?.id ?? "done";
}

function formatDue(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

/**
 * "No tasks yet." was a dead end. An empty board is the first thing a new
 * user sees, and in milindCal it is also the best place to teach the single
 * idea the whole app rests on: a task dragged onto the calendar does not
 * become a copy, it *is* the same record with a time on it. Saying that here
 * costs nothing — the space is already empty.
 */
const BoardEmptyState = memo(function BoardEmptyState() {
  return (
    <div className="board-empty">
      <p className="board-empty__lead">Nothing here yet.</p>
      <p className="board-empty__hint">
        Add one above — then drag it onto the calendar to give it a time, or
        into milindDocs to write against it. It stays the same item either way.
      </p>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Kanban Card                                                        */
/* ------------------------------------------------------------------ */

const KanbanCard = memo(function KanbanCard({
  task, columns, onToggle, onDelete, onMoveToColumn, onOpenDoc,
}: {
  task: Task;
  columns: KanbanColumn[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToColumn: (id: string, colId: string) => void;
  onOpenDoc: (id: string) => void;
}) {
  const currentColId = resolveColumnId(task, columns);
  const currentCol = columns.find((c) => c.id === currentColId);
  const borderColor = currentCol?.color ?? IMPORTANCE_COLORS[task.importance ?? "medium"];
  const dueFmt = task.dueDate ? formatDue(task.dueDate) : null;
  const drag = useUniversalDraggable(payloadFromTask(task));

  return (
    <motion.div
      animate={{ opacity: drag.isDragging ? 0.35 : 1, y: 0 }}
      className={`kanban-card ${task.completed ? "done" : ""}`}
      exit={{ opacity: 0, scale: 0.95 }}
      initial={{ opacity: 0, y: 8 }}
      layout
      ref={drag.setNodeRef}
      style={{ borderLeftColor: borderColor, touchAction: "none" }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      whileHover={{ y: -2, boxShadow: "0 6px 18px rgba(0,0,0,0.1)" }}
      {...drag.attributes}
      {...drag.listeners}
    >
      <div className="kanban-card-top">
        <button
          className={`kanban-check ${task.completed ? "done" : ""}`}
          onClick={() => onToggle(task.id)}
          type="button"
        >
          <Check size={11} />
        </button>
        <span className="kanban-card-title">{task.title}</span>
        <button
          aria-label="Open as doc"
          className="kanban-card-open-doc"
          onClick={() => onOpenDoc(task.id)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Open as doc"
          type="button"
        >
          <PenLine size={11} />
        </button>
        <button className="kanban-card-del" onClick={() => onDelete(task.id)} type="button">
          <X size={11} />
        </button>
      </div>

      {task.description && <p className="kanban-card-desc">{task.description}</p>}

      <BacklinksList entityKey={entityKey("task", task.id)} label="" />

      {(dueFmt || task.assigneeEmail || task.source === "asana") && (
        <div className="kanban-card-meta">
          {dueFmt && <span className="kanban-meta-pill due"><Calendar size={9} /> {dueFmt}</span>}
          {task.assigneeEmail && (
            <span className="kanban-meta-pill assignee" title={task.assigneeEmail}>
              <User size={9} /> {task.assigneeEmail.split("@")[0]}
            </span>
          )}
          {task.source === "asana" && (
            <span className="kanban-meta-pill asana-badge" title={task.asanaProjectName ?? "Asana"}>
              <Link2 size={9} /> {task.asanaProjectName ? task.asanaProjectName.slice(0, 14) : "Asana"}
            </span>
          )}
        </div>
      )}

      {!task.completed && (
        <div className="kanban-card-move">
          {columns
            .filter((c) => c.id !== currentColId)
            .map((col) => (
              <button
                className="kanban-move-btn"
                key={col.id}
                onClick={() => onMoveToColumn(task.id, col.id)}
                style={{ "--col-color": col.color } as React.CSSProperties}
                title={`Move to ${col.label}`}
                type="button"
              >
                → {col.label}
              </button>
            ))}
        </div>
      )}
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/*  Draggable list-view task row                                       */
/* ------------------------------------------------------------------ */

const TaskListItem = memo(function TaskListItem({
  task, onToggle, onDelete, onOpenDoc, showAttachBadge = false, hoverScale = false,
}: {
  task: Task;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenDoc: (id: string) => void;
  showAttachBadge?: boolean;
  hoverScale?: boolean;
}) {
  const drag = useUniversalDraggable(payloadFromTask(task));
  return (
    <motion.div
      animate={{ opacity: drag.isDragging ? 0.35 : 1, y: 0 }}
      className="task-item"
      exit={{ opacity: 0, y: -8 }}
      initial={{ opacity: 0, y: 12 }}
      layout
      ref={drag.setNodeRef}
      style={{ touchAction: "none" }}
      title="Drag to a task column, doc, or the calendar"
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      whileHover={hoverScale ? { x: 3, scale: 1.01 } : { x: 3 }}
      {...drag.attributes}
      {...drag.listeners}
    >
      <motion.button
        className={`task-toggle${task.completed ? " done" : ""}`}
        onClick={() => onToggle(task.id)}
        // stop dnd-kit's drag start when clicking the toggle button
        onPointerDown={(e) => e.stopPropagation()}
        type="button"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
      >
        <Check size={14} />
      </motion.button>
      <div className="task-body">
        <p className={task.completed ? "completed" : ""}>{task.title}</p>
        {task.description && (
          <p className="task-desc-preview">{task.description}</p>
        )}
        <div className="task-meta">
          <span
            className="task-importance-badge"
            style={{ "--importance-color": IMPORTANCE_COLORS[task.importance ?? "medium"] } as React.CSSProperties}
          >
            <Flag size={9} /> {IMPORTANCE_LABELS[task.importance ?? "medium"]}
          </span>
          {task.dueDate && (
            <span className="task-due-badge">
              <Calendar size={9} /> {formatDue(task.dueDate)}
            </span>
          )}
          {task.assigneeEmail && (
            <span className="task-assignee-badge" title={task.assigneeEmail}>
              <User size={9} /> {task.assigneeEmail.split("@")[0]}
            </span>
          )}
          {showAttachBadge && task.attachedToEventKey && (
            <span className="task-attached-badge" title="Attached to event on canvas">⚓</span>
          )}
        </div>
        <BacklinksList entityKey={entityKey("task", task.id)} label="" />
      </div>
      <motion.button
        aria-label="Open as doc"
        className="task-open-doc"
        onClick={() => onOpenDoc(task.id)}
        onPointerDown={(e) => e.stopPropagation()}
        title="Open as doc"
        type="button"
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.92 }}
      >
        <PenLine size={13} />
      </motion.button>
      <motion.button
        aria-label="Delete task"
        className="task-delete"
        onClick={() => onDelete(task.id)}
        onPointerDown={(e) => e.stopPropagation()}
        type="button"
        whileHover={{ scale: 1.07, rotate: -4 }}
        whileTap={{ scale: 0.92 }}
      >
        <Trash2 size={14} />
      </motion.button>
    </motion.div>
  );
});

/* ------------------------------------------------------------------ */
/*  Kanban column drop zone wrapper                                    */
/* ------------------------------------------------------------------ */

function KanbanColumnDropZone({
  col, children,
}: {
  col: KanbanColumn;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useUniversalDroppable({
    id: `task-col:${col.id}`,
    targetKind: "task",
    data: { columnId: col.id },
  });
  return (
    <div
      className={`kanban-col${isOver ? " universal-droppable--active" : ""}`}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Kanban Board                                                */
/* ------------------------------------------------------------------ */

const InlineKanbanBoard = memo(function InlineKanbanBoard({
  tasks, columns, onColumnsChange, onToggle, onDelete, onMoveToColumn, onOpenDoc,
}: {
  tasks: Task[];
  columns: KanbanColumn[];
  onColumnsChange: (cols: KanbanColumn[]) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToColumn: (id: string, colId: string) => void;
  onOpenDoc: (id: string) => void;
}) {
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const byColumn = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const c of columns) map[c.id] = [];
    for (const t of tasks) {
      const colId = resolveColumnId(t, columns);
      if (map[colId] !== undefined) map[colId].push(t);
    }
    return map;
  }, [tasks, columns]);

  const startEdit = (col: KanbanColumn) => {
    setEditingColId(col.id);
    setEditingLabel(col.label);
  };

  const commitEdit = () => {
    if (editingColId && editingLabel.trim()) {
      onColumnsChange(columns.map((c) => (c.id === editingColId ? { ...c, label: editingLabel.trim() } : c)));
    }
    setEditingColId(null);
  };

  const addColumn = () => {
    const id = uuid().slice(0, 8);
    onColumnsChange([...columns, { id, label: "New Column", color: "#8b5cf6" }]);
  };

  const removeColumn = (colId: string) => {
    if (columns.length <= 1) return;
    onColumnsChange(columns.filter((c) => c.id !== colId));
  };

  return (
    <div className="board-panel kanban-panel">
      <div className="kanban-columns">
        {columns.map((col) => (
          <KanbanColumnDropZone col={col} key={col.id}>
            <div className="kanban-col-header" style={{ "--col-color": col.color } as React.CSSProperties}>
              <span className="kanban-col-dot" />
              {editingColId === col.id ? (
                <input
                  autoFocus
                  className="kanban-col-rename"
                  onBlur={commitEdit}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingColId(null);
                  }}
                  value={editingLabel}
                />
              ) : (
                <button
                  className="kanban-col-label-btn"
                  onClick={() => startEdit(col)}
                  title="Click to rename"
                  type="button"
                >
                  {col.label}
                </button>
              )}
              <span className="kanban-col-count">{(byColumn[col.id] ?? []).length}</span>
              <button
                className="kanban-col-del"
                onClick={() => removeColumn(col.id)}
                title="Remove column"
                type="button"
              >
                <X size={10} />
              </button>
            </div>
            <div className="kanban-col-body">
              <AnimatePresence initial={false}>
                {(byColumn[col.id] ?? []).map((task) => (
                  <KanbanCard
                    columns={columns}
                    key={task.id}
                    onDelete={onDelete}
                    onMoveToColumn={onMoveToColumn}
                    onOpenDoc={onOpenDoc}
                    onToggle={onToggle}
                    task={task}
                  />
                ))}
              </AnimatePresence>
              {(byColumn[col.id] ?? []).length === 0 && (
                <p className="kanban-col-empty">No tasks</p>
              )}
            </div>
          </KanbanColumnDropZone>
        ))}
        <button className="kanban-add-col" onClick={addColumn} type="button">
          <Plus size={12} /> Add column
        </button>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Timeline View                                                      */
/* ------------------------------------------------------------------ */

const TimelineView = memo(function TimelineView({
  tasks, onToggle, onDelete,
}: {
  tasks: Task[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const tomorrowStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10);
  }, []);
  const weekEndStr = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10);
  }, []);

  const groups = useMemo(() => {
    const buckets: Record<string, Task[]> = {
      overdue: [], today: [], tomorrow: [], thisWeek: [], later: [], noDate: [], done: [],
    };
    for (const t of tasks) {
      if (t.completed) { buckets.done.push(t); continue; }
      if (!t.dueDate) { buckets.noDate.push(t); continue; }
      if (t.dueDate < todayStr) { buckets.overdue.push(t); continue; }
      if (t.dueDate === todayStr) { buckets.today.push(t); continue; }
      if (t.dueDate === tomorrowStr) { buckets.tomorrow.push(t); continue; }
      if (t.dueDate <= weekEndStr) { buckets.thisWeek.push(t); continue; }
      buckets.later.push(t);
    }
    return [
      { key: "overdue",  label: "Overdue",     color: "#ef4444", tasks: buckets.overdue },
      { key: "today",    label: "Today",        color: "#f59e0b", tasks: buckets.today },
      { key: "tomorrow", label: "Tomorrow",     color: "#3b82f6", tasks: buckets.tomorrow },
      { key: "thisWeek", label: "This Week",    color: "#8b5cf6", tasks: buckets.thisWeek },
      { key: "later",    label: "Later",        color: "#6b7280", tasks: buckets.later },
      { key: "noDate",   label: "No Date",      color: "#9ca3af", tasks: buckets.noDate },
      { key: "done",     label: "Done",         color: "#10b981", tasks: buckets.done },
    ].filter((g) => g.tasks.length > 0);
  }, [tasks, todayStr, tomorrowStr, weekEndStr]);

  return (
    <div className="board-panel timeline-panel">
      {groups.length === 0 && <BoardEmptyState />}
      {groups.map((group) => (
        <div className="timeline-group" key={group.key}>
          <div
            className="timeline-group-header"
            style={{ "--group-color": group.color } as React.CSSProperties}
          >
            <span className="timeline-group-dot" />
            <span className="timeline-group-label">{group.label}</span>
            <span className="timeline-group-count">{group.tasks.length}</span>
          </div>
          <div className="timeline-group-body">
            {group.tasks.map((task) => (
              <div className={`timeline-task ${task.completed ? "done" : ""}`} key={task.id}>
                <button
                  className={`task-toggle ${task.completed ? "done" : ""}`}
                  onClick={() => onToggle(task.id)}
                  type="button"
                >
                  <Check size={12} />
                </button>
                <div className="timeline-task-body">
                  <p className={task.completed ? "completed" : ""}>{task.title}</p>
                  {task.description && (
                    <p className="timeline-task-desc">{task.description}</p>
                  )}
                  <div className="task-meta">
                    <span
                      className="task-importance-badge"
                      style={{ "--importance-color": IMPORTANCE_COLORS[task.importance ?? "medium"] } as React.CSSProperties}
                    >
                      <Flag size={8} /> {IMPORTANCE_LABELS[task.importance ?? "medium"]}
                    </span>
                    {task.dueDate && (
                      <span className="task-due-badge">
                        <Calendar size={8} /> {formatDue(task.dueDate)}
                      </span>
                    )}
                    {task.assigneeEmail && (
                      <span className="task-assignee-badge" title={task.assigneeEmail}>
                        <User size={8} /> {task.assigneeEmail.split("@")[0]}
                      </span>
                    )}
                  </div>
                </div>
                <button className="task-delete" onClick={() => onDelete(task.id)} type="button">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Main sidebar                                                       */
/* ------------------------------------------------------------------ */

export function TasksSidebar({
  onExpandChange,
}: {
  onExpandChange?: (expanded: boolean) => void;
}) {
  /* Tasks state — single source of truth lives in EntityStoreProvider so
   * calendar-workspace and docs can mutate the same set. */
  const tasks = useTasks();
  const { setTasks, openAsDoc } = useEntityActions();

  /* KanbanCard and TaskListItem are memo()'d, but that only pays off while
   * their props keep their identity. toggleTask/deleteTask/moveTaskToColumn
   * were plain function expressions, so every render of this component minted
   * new ones and forced every card to re-render through the memo. With 13
   * per-keystroke setters living in this same component body, typing one
   * character into the compose box re-rendered the entire board.
   *
   * Reading `tasks` through a ref lets all three be genuinely stable. */
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const [inputValue, setInputValue] = useState("");
  const [expandedAdd, setExpandedAdd] = useState(false);
  const [draftImportance, setDraftImportance] = useState<TaskImportance>("medium");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  /* Board state */
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [boardView, setBoardView] = useState<BoardView>("kanban");
  const [emailBoardExpanded, setEmailBoardExpanded] = useState(false);
  const [columns, setColumns] = useState<KanbanColumn[]>(DEFAULT_KANBAN_COLUMNS);

  /* Tabs */
  const [activePanel, setActivePanel] = useState<"tasks" | "emails">("tasks");

  /* Email state */
  const [emails, setEmails] = useState<GmailMessageSummary[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<GmailMessageDetail | null>(null);
  const [emailDetailLoading, setEmailDetailLoading] = useState(false);
  const [emailDetailError, setEmailDetailError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "reply-all">("reply");
  const [replyCc, setReplyCc] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
  const [showReplyCcBcc, setShowReplyCcBcc] = useState(false);
  const [emailActionLoading, setEmailActionLoading] = useState<"archive" | "reply" | "compose" | null>(null);
  const [emailActionStatus, setEmailActionStatus] = useState<string | null>(null);
  /* Compose state */
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [showComposeCcBcc, setShowComposeCcBcc] = useState(false);
  /* Contacts */
  const [contacts, setContacts] = useState<GmailContact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readEmailsAbortRef = useRef<AbortController | null>(null);
  const openEmailAbortRef = useRef<AbortController | null>(null);

  /* Asana state */
  const [asanaConnected, setAsanaConnected] = useState<boolean | null>(null);
  const [asanaUserName, setAsanaUserName] = useState("");
  const [asanaSyncing, setAsanaSyncing] = useState(false);
  const [asanaError, setAsanaError] = useState<string | null>(null);
  const asanaSyncVersionRef = useRef<number>(0);
  const saveColumnsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Fallback droppable: drops that miss a specific kanban column (e.g. in
   * list view, or the empty area below cards) still land on the sidebar
   * and convert to tasks. Nested per-column droppables take priority. */
  const panelDroppable = useUniversalDroppable({ id: "task-sidebar", targetKind: "task" });

  /* "Open as doc" — reuse a linked doc if one exists, else create one seeded
   * with the task's title/description. Store raises the docs panel. */
  const handleOpenTaskAsDoc = useCallback(
    (id: string) => {
      const t = tasks.find((task) => task.id === id);
      if (!t) return;
      openAsDoc(entityKey("task", id), { title: t.title, description: t.description });
    },
    [tasks, openAsDoc],
  );

  /* Tasks load/save is handled by EntityStoreProvider. Importance defaults
   * are applied in the provider's initial read. */

  /* Load columns */
  useEffect(() => {
    const raw = localStorage.getItem(KANBAN_COLUMNS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as KanbanColumn[];
      if (Array.isArray(parsed) && parsed.length > 0) setColumns(parsed);
    } catch { /* ignore */ }
  }, []);

  /* Save columns — debounced 400 ms */
  useEffect(() => {
    if (saveColumnsTimerRef.current) clearTimeout(saveColumnsTimerRef.current);
    saveColumnsTimerRef.current = setTimeout(() => {
      localStorage.setItem(KANBAN_COLUMNS_KEY, JSON.stringify(columns));
    }, 400);
    return () => {
      if (saveColumnsTimerRef.current) clearTimeout(saveColumnsTimerRef.current);
    };
  }, [columns]);

  /* Propagate board expanded state */
  useEffect(() => {
    onExpandChange?.(boardExpanded || emailBoardExpanded);
  }, [boardExpanded, emailBoardExpanded, onExpandChange]);

  /* ---------------------------------------------------------------- */
  /*  Asana integration                                               */
  /* ---------------------------------------------------------------- */

  /** Fetch Asana tasks and merge into state, replacing any previous Asana tasks. */
  const loadAsanaTasks = useCallback(async () => {
    setAsanaSyncing(true);
    setAsanaError(null);
    try {
      const resp = await fetch("/api/asana/tasks", { cache: "no-store" });
      const body = await resp.json() as { tasks?: Task[]; error?: string };
      if (!resp.ok) throw new Error(body.error ?? "Failed to sync Asana");
      setTasks((prev) => [
        ...(body.tasks ?? []),
        ...prev.filter((t) => t.source !== "asana"),
      ]);
    } catch (err) {
      setAsanaError(err instanceof Error ? err.message : "Asana sync failed");
    } finally {
      setAsanaSyncing(false);
    }
  }, [setTasks]);

  /** Check Asana connection status on mount and load tasks if connected. */
  useEffect(() => {
    void (async () => {
      try {
        const resp = await fetch("/api/asana/status", { cache: "no-store" });
        const data = await resp.json() as { connected: boolean; userName?: string };
        setAsanaConnected(data.connected);
        if (data.connected) {
          if (data.userName) setAsanaUserName(data.userName);
          void loadAsanaTasks();
        }
      } catch {
        setAsanaConnected(false);
      }
    })();
  }, [loadAsanaTasks]);

  /** Poll for webhook-triggered version changes every 20 s, but only while the
   *  tab is visible — a backgrounded tab has nothing to show, and every tick
   *  costs a session decrypt plus a KV read server-side. Coming back to the
   *  tab triggers an immediate catch-up poll, so no change is missed. */
  useEffect(() => {
    if (!asanaConnected) return;
    const tick = async () => {
      try {
        const resp = await fetch("/api/asana/version", { cache: "no-store" });
        if (!resp.ok) return;
        const { version } = await resp.json() as { version: number };
        if (asanaSyncVersionRef.current !== 0 && version !== asanaSyncVersionRef.current) {
          void loadAsanaTasks();
        }
        asanaSyncVersionRef.current = version;
      } catch { /* network errors are tolerated */ }
    };

    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void tick();
    }, 20_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [asanaConnected, loadAsanaTasks]);

  const disconnectAsana = useCallback(async () => {
    try {
      await fetch("/api/asana/status", { method: "DELETE" });
    } catch { /* ok */ }
    setAsanaConnected(false);
    setAsanaUserName("");
    setAsanaError(null);
    setTasks((prev) => prev.filter((t) => t.source !== "asana"));
  }, [setTasks]);

  const remainingCount = useMemo(() => tasks.filter((t) => !t.completed).length, [tasks]);

  /* ---------------------------------------------------------------- */
  /*  Task actions                                                    */
  /* ---------------------------------------------------------------- */

  const addTask = async () => {
    const title = inputValue.trim();
    if (!title) { setExpandedAdd(true); return; }

    const localDraft: Task = {
      id: uuid(),
      title,
      description: draftDescription.trim() || undefined,
      completed: false,
      createdAt: Date.now(),
      importance: draftImportance,
      dueDate: draftDueDate || undefined,
      assigneeEmail: draftEmail.trim() || undefined,
      source: "local",
    };

    setInputValue("");
    setDraftDueDate("");
    setDraftEmail("");
    setDraftDescription("");
    setDraftImportance("medium");
    setExpandedAdd(false);

    if (asanaConnected) {
      try {
        const resp = await fetch("/api/asana/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: title,
            notes: draftDescription.trim() || undefined,
            due_on: draftDueDate || undefined,
          }),
        });
        const body = await resp.json() as { task?: { gid: string }; error?: string };
        if (!resp.ok) throw new Error(body.error ?? "Failed to create in Asana");
        const gid = body.task?.gid;
        if (!gid) throw new Error("Asana task created but GID missing");
        setTasks((prev) => [
          {
            ...localDraft,
            id: `asana_${gid}`,
            asanaGid: gid,
            source: "asana" as const,
          },
          ...prev,
        ]);
      } catch {
        setAsanaError("Couldn't create task in Asana — saved locally instead");
        setTasks((prev) => [localDraft, ...prev]);
      }
    } else {
      setTasks((prev) => [localDraft, ...prev]);
    }
  };

  const toggleTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    const newCompleted = !task.completed;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: newCompleted } : t)));
    if (task.asanaGid) {
      fetch(`/api/asana/tasks/${task.asanaGid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: newCompleted }),
      }).catch(() => {
        setAsanaError("Failed to sync completion to Asana");
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: task.completed } : t)));
      });
    }
  }, [setTasks]);

  const deleteTask = useCallback((id: string) => {
    const task = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (task?.asanaGid) {
      fetch(`/api/asana/tasks/${task.asanaGid}`, { method: "DELETE" })
        .catch(() => setAsanaError("Failed to delete task in Asana"));
    }
  }, [setTasks]);

  const moveTaskToColumn = useCallback((id: string, colId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const isDone = colId === "done";
        return { ...t, columnId: isDone ? undefined : colId, completed: isDone };
      })
    );
  }, [setTasks]);

  /* ---------------------------------------------------------------- */
  /*  Email helpers                                                   */
  /* ---------------------------------------------------------------- */

  const readEmails = useCallback(async () => {
    readEmailsAbortRef.current?.abort();
    const controller = new AbortController();
    readEmailsAbortRef.current = controller;

    setEmailsLoading(true);
    setEmailsError(null);
    try {
      const response = await fetch("/api/google/emails?max=8", { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to sync Gmail");
      }
      const data = (await response.json()) as { emails: GmailMessageSummary[] };
      setEmails(Array.isArray(data.emails) ? data.emails : []);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setEmailsError(error instanceof Error ? error.message : "Unable to sync Gmail");
    } finally {
      setEmailsLoading(false);
    }
  }, []);

  const openEmail = useCallback(async (emailId: string) => {
    openEmailAbortRef.current?.abort();
    const controller = new AbortController();
    openEmailAbortRef.current = controller;

    setSelectedEmailId(emailId);
    setSelectedEmail(null);
    setEmailDetailLoading(true);
    setEmailDetailError(null);
    setEmailActionStatus(null);
    try {
      const response = await fetch(`/api/google/emails/${emailId}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to open email");
      }
      const data = (await response.json()) as { email: GmailMessageDetail };
      setSelectedEmail(data.email);
      setReplyText("");
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setEmailDetailError(error instanceof Error ? error.message : "Unable to open email");
    } finally {
      setEmailDetailLoading(false);
    }
  }, []);

  const closeEmail = useCallback(() => {
    setSelectedEmailId(null);
    setSelectedEmail(null);
    setEmailDetailLoading(false);
    setEmailActionLoading(null);
    setEmailDetailError(null);
    setEmailActionStatus(null);
    setReplyText("");
    setReplyMode("reply");
    setReplyCc("");
    setReplyBcc("");
    setShowReplyCcBcc(false);
  }, []);

  const archiveSelectedEmail = useCallback(async () => {
    if (!selectedEmail) return;
    setEmailActionLoading("archive");
    setEmailDetailError(null);
    setEmailActionStatus(null);
    try {
      const response = await fetch(`/api/google/emails/${selectedEmail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to archive email");
      }
      setEmails((prev) => prev.filter((e) => e.id !== selectedEmail.id));
      setSelectedEmailId(null);
      setSelectedEmail(null);
      setReplyText("");
      setEmailActionStatus("Archived successfully.");
    } catch (error) {
      setEmailDetailError(error instanceof Error ? error.message : "Unable to archive email");
    } finally {
      setEmailActionLoading(null);
    }
  }, [selectedEmail]);

  const sendReply = useCallback(async () => {
    if (!selectedEmail) return;
    const shortReply = replyText.trim();
    if (!shortReply) return;
    setEmailActionLoading("reply");
    setEmailDetailError(null);
    setEmailActionStatus(null);
    try {
      const response = await fetch(`/api/google/emails/${selectedEmail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: replyMode,
          replyText: shortReply,
          cc: replyCc.trim() || undefined,
          bcc: replyBcc.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to send reply");
      }
      setReplyText("");
      setReplyCc("");
      setReplyBcc("");
      setShowReplyCcBcc(false);
      const label = replyMode === "reply-all" ? "Reply all sent" : "Reply sent";
      setEmailActionStatus(`${label} to ${selectedEmail.from.replace(/<[^>]+>/g, "").trim()}.`);
    } catch (error) {
      setEmailDetailError(
        error instanceof Error
          ? error.message.includes("permission") || error.message.includes("scope")
            ? "Gmail send permission missing. Sign out and re-grant access."
            : error.message
          : "Unable to send reply"
      );
    } finally {
      setEmailActionLoading(null);
    }
  }, [replyMode, replyText, replyCc, replyBcc, selectedEmail]);

  const sendCompose = useCallback(async () => {
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const body = composeBody.trim();
    if (!to || !subject || !body) return;
    setEmailActionLoading("compose");
    setEmailActionStatus(null);
    setEmailDetailError(null);
    try {
      const response = await fetch("/api/google/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          body,
          cc: composeCc.trim() || undefined,
          bcc: composeBcc.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "Unable to send email");
      }
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeCc("");
      setComposeBcc("");
      setShowComposeCcBcc(false);
      setEmailActionStatus(`Email sent to ${to}.`);
    } catch (error) {
      setEmailDetailError(error instanceof Error ? error.message : "Unable to send email");
    } finally {
      setEmailActionLoading(null);
    }
  }, [composeTo, composeSubject, composeBody, composeCc, composeBcc]);

  const fetchContacts = useCallback(async () => {
    if (contactsLoaded) return;
    try {
      const res = await fetch("/api/google/contacts", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { contacts: GmailContact[] };
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
    } catch {
      // silently fail — contacts are optional
    } finally {
      setContactsLoaded(true);
    }
  }, [contactsLoaded]);

  const resizeFrame = useCallback(() => {
    // In expanded reader mode the iframe height is controlled by CSS flex.
    // Overriding it here would fight the layout, so skip.
    if (emailBoardExpanded) return;
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (doc?.documentElement) {
        frame.style.height = `${Math.min(doc.documentElement.scrollHeight + 16, 700)}px`;
      }
    } catch {
      frame.style.height = "440px";
    }
  }, [emailBoardExpanded]);

  useEffect(() => {
    if (activePanel !== "emails") return;
    if (emails.length > 0 || emailsLoading || emailsError) return;
    void readEmails();
  }, [activePanel, emails.length, emailsLoading, emailsError, readEmails]);

  useEffect(() => {
    if (activePanel === "emails") void fetchContacts();
  }, [activePanel, fetchContacts]);

  useEffect(() => {
    if (activePanel === "tasks") {
      closeEmail();
      setEmailBoardExpanded(false);
      setComposeOpen(false);
    }
  }, [activePanel, closeEmail]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className={`tasks-sidebar${boardExpanded ? " board-expanded" : ""}${activePanel === "emails" && !boardExpanded ? " email-expanded" : ""}${emailBoardExpanded ? " email-reader-mode" : ""}`}
      initial={{ opacity: 0, x: 18 }}
      transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {/* Header */}
      <motion.div className="tasks-header" layout>
        <motion.h2
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: -4 }}
          key={activePanel}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {activePanel === "tasks" ? "Tasks" : "Gmail"}
        </motion.h2>
        <motion.span
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          key={`count-${activePanel}`}
          transition={{ duration: 0.18, delay: 0.05 }}
        >
          {activePanel === "tasks" ? `${remainingCount} open` : `${emails.length} emails`}
        </motion.span>
      </motion.div>

      {/* Tab switcher — always visible regardless of board state */}
      <div className="sidebar-switcher" role="tablist" aria-label="Sidebar section switcher">
        <motion.button
          animate={activePanel === "tasks" ? { scale: 1.02 } : { scale: 1 }}
          aria-selected={activePanel === "tasks"}
          className={activePanel === "tasks" ? "active" : ""}
          onClick={() => setActivePanel("tasks")}
          role="tab"
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          Tasks
        </motion.button>
        <motion.button
          animate={activePanel === "emails" ? { scale: 1.02 } : { scale: 1 }}
          aria-selected={activePanel === "emails"}
          className={activePanel === "emails" ? "active" : ""}
          onClick={() => setActivePanel("emails")}
          role="tab"
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          Email
        </motion.button>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {activePanel === "tasks" ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`tasks-panel${panelDroppable.isOver ? " universal-droppable--active" : ""}`}
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: 8 }}
            key="tasks"
            ref={panelDroppable.setNodeRef}
            transition={{ duration: 0.18 }}
          >
            {/* Toolbar: expand/close + view switcher */}
            <div className="tasks-section-toolbar">
              {boardExpanded ? (
                <>
                  <div className="board-view-pills">
                    {BOARD_VIEWS.map((v) => (
                      <button
                        className={`view-pill${boardView === v ? " active" : ""}`}
                        key={v}
                        onClick={() => setBoardView(v)}
                        type="button"
                      >
                        {v === "list" ? <List size={11} /> : v === "kanban" ? <LayoutGrid size={11} /> : <Clock size={11} />}
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                  <motion.button
                    aria-label="Close board"
                    className="board-close-btn"
                    onClick={() => setBoardExpanded(false)}
                    type="button"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.92 }}
                  >
                    <X size={14} />
                  </motion.button>
                </>
              ) : (
                <>
                  <span className="tasks-section-label">All tasks</span>
                  <motion.button
                    aria-label="Open board view"
                    className="kanban-open-btn"
                    onClick={() => setBoardExpanded(true)}
                    title="Board / timeline view"
                    type="button"
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.93 }}
                  >
                    <LayoutGrid size={14} />
                  </motion.button>
                </>
              )}
            </div>

            {/* Asana integration banner */}
            <div className="asana-banner">
              {asanaConnected === null && (
                <span className="asana-pill checking">Checking Asana…</span>
              )}
              {asanaConnected === false && (
                <div className="asana-setup-hint">
                  <span className="asana-pill disconnected">
                    <span className="asana-dot" /> Asana not connected
                  </span>
                  <span className="asana-hint-text">
                    Add <code>ASANA_ACCESS_TOKEN</code> to <code>.env.local</code> and restart the server.{" "}
                    <a
                      href="https://app.asana.com/0/my-apps"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="asana-hint-link"
                    >
                      Get token ↗
                    </a>
                  </span>
                </div>
              )}
              {asanaConnected === true && (
                <div className="asana-connected-row">
                  <span className="asana-pill connected">
                    <span className="asana-dot" />
                    {asanaUserName ? asanaUserName : "Asana"}
                    {asanaSyncing ? " · syncing…" : " · synced"}
                  </span>
                  <button
                    aria-label="Refresh Asana tasks"
                    className="asana-icon-btn"
                    disabled={asanaSyncing}
                    onClick={() => void loadAsanaTasks()}
                    title="Refresh"
                    type="button"
                  >
                    <RefreshCw className={asanaSyncing ? "spin" : ""} size={11} />
                  </button>
                  <button
                    aria-label="Disconnect Asana"
                    className="asana-icon-btn disconnect"
                    onClick={() => void disconnectAsana()}
                    title="Disconnect Asana"
                    type="button"
                  >
                    <Unlink size={11} />
                  </button>
                </div>
              )}
              {asanaError && (
                <div className="asana-error-row">
                  <span className="asana-error-text">{asanaError}</span>
                  <button
                    aria-label="Dismiss error"
                    className="asana-icon-btn"
                    onClick={() => setAsanaError(null)}
                    type="button"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>

            {/* Task input */}
            <motion.div className="task-input-section" layout>
              <div className="task-input-row">
                <input
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addTask(); }}
                  placeholder="Add a task…"
                  value={inputValue}
                />
                <div className={`task-split-btn${expandedAdd ? " expanded" : ""}`}>
                  <motion.button
                    aria-label="Add task"
                    className="split-add"
                    onClick={() => void addTask()}
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.93 }}
                  >
                    <Plus size={15} />
                  </motion.button>
                  <span className="split-divider" />
                  <motion.button
                    aria-label="Toggle task details"
                    className="split-expand"
                    onClick={() => setExpandedAdd((v) => !v)}
                    type="button"
                    whileTap={{ scale: 0.93 }}
                  >
                    <motion.span
                      animate={{ rotate: expandedAdd ? 180 : 0 }}
                      style={{ display: "flex", alignItems: "center" }}
                      transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                    >
                      <ChevronDown size={12} />
                    </motion.span>
                  </motion.button>
                </div>
              </div>

              <AnimatePresence>
                {expandedAdd && (
                  <motion.div
                    animate={{ opacity: 1, height: "auto" }}
                    className="task-extra-fields"
                    exit={{ opacity: 0, height: 0 }}
                    initial={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="task-field-row">
                      <Flag size={12} />
                      <span className="task-field-label">Priority</span>
                      <div className="importance-selector">
                        {(["low", "medium", "high"] as TaskImportance[]).map((level) => (
                          <button
                            className={`importance-btn${draftImportance === level ? " active" : ""}`}
                            key={level}
                            onClick={() => setDraftImportance(level)}
                            style={{ "--importance-color": IMPORTANCE_COLORS[level] } as React.CSSProperties}
                            type="button"
                          >
                            {IMPORTANCE_LABELS[level]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="task-field-row">
                      <Calendar size={12} />
                      <span className="task-field-label">Due</span>
                      <input
                        className="task-date-input"
                        onChange={(e) => setDraftDueDate(e.target.value)}
                        type="date"
                        value={draftDueDate}
                      />
                    </div>

                    <div className="task-field-row">
                      <User size={12} />
                      <span className="task-field-label">Person</span>
                      <input
                        className="task-email-input"
                        onChange={(e) => setDraftEmail(e.target.value)}
                        placeholder="email@example.com"
                        type="email"
                        value={draftEmail}
                      />
                    </div>

                    <div className="task-field-row task-field-desc-row">
                      <AlignLeft size={12} />
                      <span className="task-field-label">Notes</span>
                      <textarea
                        className="task-desc-input"
                        onChange={(e) => setDraftDescription(e.target.value)}
                        placeholder="Add details…"
                        rows={2}
                        value={draftDescription}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Board views or compact list */}
            {boardExpanded ? (
              boardView === "kanban" ? (
                <InlineKanbanBoard
                  columns={columns}
                  onColumnsChange={setColumns}
                  onDelete={deleteTask}
                  onMoveToColumn={moveTaskToColumn}
                  onOpenDoc={handleOpenTaskAsDoc}
                  onToggle={toggleTask}
                  tasks={tasks}
                />
              ) : boardView === "timeline" ? (
                <TimelineView
                  onDelete={deleteTask}
                  onToggle={toggleTask}
                  tasks={tasks}
                />
              ) : (
                <div className="board-panel expanded-list-panel">
                  <AnimatePresence initial={false}>
                    {tasks.map((task) => (
                      <TaskListItem
                        key={task.id}
                        task={task}
                        onToggle={toggleTask}
                        onDelete={deleteTask}
                        onOpenDoc={handleOpenTaskAsDoc}
                      />
                    ))}
                  </AnimatePresence>
                  {tasks.length === 0 && <BoardEmptyState />}
                </div>
              )
            ) : (
              <motion.div
                animate="show"
                initial="hidden"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
                }}
              >
                <AnimatePresence initial={false}>
                  {tasks.map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      onToggle={toggleTask}
                      onDelete={deleteTask}
                      onOpenDoc={handleOpenTaskAsDoc}
                      showAttachBadge
                      hoverScale
                    />
                  ))}
                </AnimatePresence>
                {/* The compact sidebar is the default view, so this is the
                  * empty state most people actually meet. */}
                {tasks.length === 0 && <BoardEmptyState />}
              </motion.div>
            )}
          </motion.div>
        ) : (
          /* ---- Email panel ---- */
          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="email-placeholder"
            exit={{ opacity: 0, y: -8 }}
            initial={{ opacity: 0, y: 8 }}
            key="emails"
            transition={{ duration: 0.18 }}
          >
            <div className="email-placeholder-title">
              <Mail size={16} />
              <h3>{composeOpen ? "New Email" : selectedEmailId ? "Email" : "Inbox"}</h3>
              {selectedEmailId && !composeOpen && (
                <button className="email-refresh" onClick={closeEmail} type="button">
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              {composeOpen ? (
                <button className="email-refresh" onClick={() => setComposeOpen(false)} type="button">
                  <X size={14} /> Cancel
                </button>
              ) : (
                <>
                  <button
                    className="email-refresh"
                    disabled={emailsLoading}
                    onClick={() => void readEmails()}
                    type="button"
                  >
                    <RefreshCw className={emailsLoading ? "spin" : ""} size={14} /> Refresh
                  </button>
                  <motion.button
                    aria-label="Compose new email"
                    className="email-compose-btn"
                    onClick={() => { setComposeOpen(true); closeEmail(); }}
                    title="Compose"
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                  >
                    <PenLine size={13} /> Compose
                  </motion.button>
                </>
              )}
              <motion.button
                aria-label={emailBoardExpanded ? "Close expanded view" : "Expand email view"}
                className="kanban-open-btn"
                onClick={() => setEmailBoardExpanded((v) => !v)}
                title={emailBoardExpanded ? "Collapse" : "Expand view"}
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.93 }}
              >
                {emailBoardExpanded ? <X size={14} /> : <Maximize2 size={14} />}
              </motion.button>
            </div>

            <AnimatePresence>
              {emailsError && (
                <motion.p
                  animate={{ opacity: 1, y: 0 }}
                  className="email-status error"
                  exit={{ opacity: 0, y: -4 }}
                  initial={{ opacity: 0, y: 6 }}
                  key="emails-error"
                  transition={{ duration: 0.2 }}
                >
                  {emailsError}
                </motion.p>
              )}
              {emailDetailError && (
                <motion.p
                  animate={{ opacity: 1, y: 0 }}
                  className="email-status error"
                  exit={{ opacity: 0, y: -4 }}
                  initial={{ opacity: 0, y: 6 }}
                  key="detail-error"
                  transition={{ duration: 0.2 }}
                >
                  {emailDetailError}
                </motion.p>
              )}
              {emailActionStatus && (
                <motion.p
                  animate={{ opacity: 1, y: 0 }}
                  className="email-status success"
                  exit={{ opacity: 0, y: -4 }}
                  initial={{ opacity: 0, y: 6 }}
                  key="action-status"
                  transition={{ duration: 0.2 }}
                >
                  {emailActionStatus}
                </motion.p>
              )}
              {emailsLoading && !selectedEmailId && (
                <motion.p
                  animate={{ opacity: 1 }}
                  className="email-status"
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                  key="emails-loading"
                  transition={{ duration: 0.18 }}
                >
                  Syncing Gmail...
                </motion.p>
              )}
            </AnimatePresence>

            {!emailsLoading && !emailsError && emails.length === 0 && !selectedEmailId && (
              <motion.p
                animate={{ opacity: 1, y: 0 }}
                className="email-status"
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
              >
                No inbox emails found.
              </motion.p>
            )}

            {/* Contacts datalist for autocomplete */}
            <datalist id="email-contacts">
              {contacts.map((c) => (
                <option key={c.email} label={c.name} value={c.email} />
              ))}
            </datalist>

            <AnimatePresence mode="wait">
              {composeOpen ? (
                /* ---- Compose panel ---- */
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="email-compose-panel"
                  exit={{ opacity: 0, y: -6 }}
                  initial={{ opacity: 0, y: 10 }}
                  key="email-compose"
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="email-compose-field">
                    <label htmlFor="compose-to">To</label>
                    <input
                      id="compose-to"
                      list="email-contacts"
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="recipient@example.com"
                      type="email"
                      value={composeTo}
                    />
                  </div>
                  <div className="email-compose-field">
                    <label htmlFor="compose-subject">Subject</label>
                    <input
                      id="compose-subject"
                      onChange={(e) => setComposeSubject(e.target.value)}
                      placeholder="Subject"
                      type="text"
                      value={composeSubject}
                    />
                  </div>
                  <button
                    className="email-ccbcc-toggle"
                    onClick={() => setShowComposeCcBcc((v) => !v)}
                    type="button"
                  >
                    <ChevronDown
                      size={12}
                      style={{ transform: showComposeCcBcc ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}
                    />
                    {showComposeCcBcc ? "Hide CC / BCC" : "Add CC / BCC"}
                  </button>
                  <AnimatePresence>
                    {showComposeCcBcc && (
                      <motion.div
                        animate={{ opacity: 1, height: "auto" }}
                        className="email-ccbcc-fields"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <div className="email-compose-field">
                          <label htmlFor="compose-cc">CC</label>
                          <input
                            id="compose-cc"
                            list="email-contacts"
                            onChange={(e) => setComposeCc(e.target.value)}
                            placeholder="cc@example.com"
                            type="text"
                            value={composeCc}
                          />
                        </div>
                        <div className="email-compose-field">
                          <label htmlFor="compose-bcc">BCC</label>
                          <input
                            id="compose-bcc"
                            list="email-contacts"
                            onChange={(e) => setComposeBcc(e.target.value)}
                            placeholder="bcc@example.com"
                            type="text"
                            value={composeBcc}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="email-compose-field">
                    <label htmlFor="compose-body">Message</label>
                    <textarea
                      id="compose-body"
                      onChange={(e) => setComposeBody(e.target.value)}
                      placeholder="Write your message…"
                      rows={5}
                      value={composeBody}
                    />
                  </div>
                  {emailDetailError && (
                    <p className="email-status error">{emailDetailError}</p>
                  )}
                  <motion.button
                    className="primary-button email-send"
                    disabled={!composeTo.trim() || !composeSubject.trim() || !composeBody.trim() || emailActionLoading === "compose"}
                    onClick={() => void sendCompose()}
                    transition={{ type: "spring", stiffness: 300, damping: 22 }}
                    type="button"
                    whileHover={{ y: -2, scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <Send size={14} /> {emailActionLoading === "compose" ? "Sending…" : "Send"}
                  </motion.button>
                </motion.div>
              ) : selectedEmailId ? (
                <motion.section
                  animate={{ opacity: 1, y: 0 }}
                  className="email-detail"
                  exit={{ opacity: 0, y: -6 }}
                  initial={{ opacity: 0, y: 10 }}
                  key="email-detail"
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                >
                  {emailDetailLoading && (
                    <motion.p
                      animate={{ opacity: 1 }}
                      className="email-status"
                      initial={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      Loading full email…
                    </motion.p>
                  )}

                  {!emailDetailLoading && (
                    <>
                      {selectedEmail ? (
                        <>
                          <div className="email-detail-header">
                            <p className="email-detail-subject">{selectedEmail.subject}</p>
                            <div className="email-detail-meta-row">
                              <span className="email-detail-sender">
                                {selectedEmail.from.replace(/<[^>]+>/g, "").trim()}
                              </span>
                              <time className="email-detail-date">
                                {new Date(selectedEmail.date).toLocaleString(undefined, {
                                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                                })}
                              </time>
                            </div>
                            {selectedEmail.to && (
                              <p className="email-detail-to">To: {selectedEmail.to}</p>
                            )}
                            {selectedEmail.cc && (
                              <p className="email-detail-to">CC: {selectedEmail.cc}</p>
                            )}
                          </div>
                          {selectedEmail.htmlBody ? (
                            <iframe
                              className="email-detail-frame"
                              onLoad={resizeFrame}
                              ref={frameRef}
                              sandbox=""
                              srcDoc={selectedEmail.htmlBody}
                              title="Email content"
                            />
                          ) : (
                            <div className="email-detail-body">{selectedEmail.body}</div>
                          )}
                        </>
                      ) : (
                        <p className="email-status error">Unable to load this email.</p>
                      )}

                      <div className="email-actions">
                        {selectedEmail && (
                          <motion.a
                            className="ghost-button email-link"
                            href={`https://mail.google.com/mail/u/0/#inbox/${selectedEmail.threadId || selectedEmail.id}`}
                            rel="noreferrer"
                            target="_blank"
                            transition={{ type: "spring", stiffness: 300, damping: 22 }}
                            whileHover={{ y: -2, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                          >
                            <ExternalLink size={14} /> Open in Gmail
                          </motion.a>
                        )}
                        <motion.button
                          className="ghost-button"
                          disabled={!selectedEmail || emailActionLoading === "archive"}
                          onClick={() => void archiveSelectedEmail()}
                          transition={{ type: "spring", stiffness: 300, damping: 22 }}
                          type="button"
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <Archive size={14} /> {emailActionLoading === "archive" ? "Archiving..." : "Archive"}
                        </motion.button>
                      </div>

                      {/* Reply mode toggle */}
                      <div className="email-reply-mode-toggle">
                        <button
                          className={`reply-mode-pill${replyMode === "reply" ? " active" : ""}`}
                          onClick={() => setReplyMode("reply")}
                          type="button"
                        >
                          <Reply size={12} /> Reply
                        </button>
                        <button
                          className={`reply-mode-pill${replyMode === "reply-all" ? " active" : ""}`}
                          onClick={() => setReplyMode("reply-all")}
                          type="button"
                        >
                          <ReplyAll size={12} /> Reply all
                        </button>
                        <button
                          className="reply-mode-pill ccbcc-toggle"
                          onClick={() => setShowReplyCcBcc((v) => !v)}
                          type="button"
                        >
                          <ChevronDown
                            size={12}
                            style={{ transform: showReplyCcBcc ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}
                          />
                          CC / BCC
                        </button>
                      </div>

                      <div className="email-reply-box">
                        <AnimatePresence>
                          {showReplyCcBcc && (
                            <motion.div
                              animate={{ opacity: 1, height: "auto" }}
                              className="email-ccbcc-fields"
                              exit={{ opacity: 0, height: 0 }}
                              initial={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18 }}
                            >
                              <div className="email-compose-field">
                                <label htmlFor="reply-cc">CC</label>
                                <input
                                  id="reply-cc"
                                  list="email-contacts"
                                  onChange={(e) => setReplyCc(e.target.value)}
                                  placeholder="cc@example.com"
                                  type="text"
                                  value={replyCc}
                                />
                              </div>
                              <div className="email-compose-field">
                                <label htmlFor="reply-bcc">BCC</label>
                                <input
                                  id="reply-bcc"
                                  list="email-contacts"
                                  onChange={(e) => setReplyBcc(e.target.value)}
                                  placeholder="bcc@example.com"
                                  type="text"
                                  value={replyBcc}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <textarea
                          id="quick-reply"
                          maxLength={1200}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write your reply…"
                          rows={3}
                          value={replyText}
                        />
                        <motion.button
                          className="primary-button email-send"
                          disabled={!selectedEmail || !replyText.trim() || emailActionLoading === "reply"}
                          onClick={() => void sendReply()}
                          transition={{ type: "spring", stiffness: 300, damping: 22 }}
                          type="button"
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          {replyMode === "reply-all" ? <ReplyAll size={14} /> : <Reply size={14} />}
                          {emailActionLoading === "reply" ? "Sending…" : replyMode === "reply-all" ? "Reply all" : "Reply"}
                        </motion.button>
                      </div>
                    </>
                  )}
                </motion.section>
              ) : (
                <motion.div
                  animate="show"
                  className="email-list"
                  initial="hidden"
                  key="email-list"
                  variants={{
                    hidden: {},
                    show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
                  }}
                >
                  {emails.map((email) => (
                    <motion.article
                      className={`email-item${email.isUnread ? " unread" : ""}`}
                      key={email.id}
                      layout
                      variants={{
                        hidden: { opacity: 0, y: 10, scale: 0.98 },
                        show: {
                          opacity: 1, y: 0, scale: 1,
                          transition: { type: "spring", stiffness: 240, damping: 22 },
                        },
                      }}
                      whileHover={{ x: 2 }}
                    >
                      <div className="email-item-header">
                        <p className="email-from">{email.from.replace(/<[^>]+>/g, "").trim()}</p>
                        <time dateTime={email.date}>
                          {new Date(email.date).toLocaleDateString(undefined, {
                            month: "short", day: "numeric",
                          })}
                        </time>
                      </div>
                      <p className="email-subject">{email.subject}</p>
                      <p className="email-snippet">{email.snippet}</p>
                      <div className="email-item-actions">
                        <motion.button
                          className="ghost-button"
                          onClick={() => void openEmail(email.id)}
                          transition={{ type: "spring", stiffness: 300, damping: 22 }}
                          type="button"
                          whileHover={{ scale: 1.04, y: -1 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          Open
                        </motion.button>
                      </div>
                    </motion.article>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
