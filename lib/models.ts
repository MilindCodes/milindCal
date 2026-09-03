import type { SheetData } from "./sheet";

export type EventTypeId = "meeting" | "focus" | "personal" | "travel" | "other";

export interface EventType {
  id: EventTypeId;
  label: string;
  color: string;
  googleColorId: string;
}

export const EVENT_TYPES: EventType[] = [
  { id: "meeting", label: "Meeting", color: "#4f8cff", googleColorId: "9" },
  { id: "focus", label: "Focus", color: "#21b6a8", googleColorId: "10" },
  { id: "personal", label: "Personal", color: "#f59e0b", googleColorId: "6" },
  { id: "travel", label: "Travel", color: "#ec4899", googleColorId: "11" },
  { id: "other", label: "Other", color: "#9ca3af", googleColorId: "8" }
];

export const EVENT_TYPE_BY_ID = Object.fromEntries(EVENT_TYPES.map((item) => [item.id, item])) as Record<
  EventTypeId,
  EventType
>;

export interface CalendarSummary {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

export interface GoogleReminder {
  method: "email" | "popup";
  minutes: number;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  recurrence: string[];
  reminders: {
    useDefault: boolean;
    overrides: GoogleReminder[];
  };
  eventType: EventTypeId;
  color: string;
  colorId: string;
  /** Google's per-event version tag. Changes whenever the event changes, so
   *  it's a cheap O(1) "has this event been modified?" check on the client. */
  etag?: string;
}

export interface GoogleEventPayload {
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  recurrence: string[];
  reminders: {
    useDefault: boolean;
    overrides: GoogleReminder[];
  };
  eventType: EventTypeId;
  colorId: string;
  timeZone: string;
}

export const GOOGLE_EVENT_COLORS = [
  { id: "1",  hex: "#a4bdfc", name: "Lavender" },
  { id: "2",  hex: "#7ae7bf", name: "Sage" },
  { id: "3",  hex: "#dbadff", name: "Grape" },
  { id: "4",  hex: "#ff887c", name: "Flamingo" },
  { id: "5",  hex: "#fbd75b", name: "Banana" },
  { id: "6",  hex: "#ffb878", name: "Tangerine" },
  { id: "7",  hex: "#46d6db", name: "Peacock" },
  { id: "8",  hex: "#e1e1e1", name: "Graphite" },
  { id: "9",  hex: "#5484ed", name: "Blueberry" },
  { id: "10", hex: "#51b749", name: "Basil" },
  { id: "11", hex: "#dc2127", name: "Tomato" },
] as const;

export const TASK_STORAGE_KEY = "milindcal.tasks.v1";
export const KANBAN_COLUMNS_KEY = "milindcal.kanban.columns.v1";
export const DOCS_KEY = "milindcal.docs.current.v1"; // legacy single-doc key (used for migration)
export const DOCS_LIBRARY_KEY = "milindcal.docs.library.v2";
export const PANEL_NOTES_KEY = "milindcal.panel.notes.v1";
export const CANVAS_PENDING_NOTE_KEY = "milindcal.canvas.pending-note";

/** Calendar event metadata attached to a milindDoc when converted from a calendar event. */
export interface MilindDocCalendarMeta {
  eventId: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  allDay: boolean;
}

/** A single document in the milindDocs library. */
export interface MilindDocFile {
  id: string;
  title: string;
  /** Tiptap JSON content — stored as plain JSON object */
  content: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  /** Calendar metadata — present when doc was converted from a calendar event */
  calendarMeta?: MilindDocCalendarMeta;
  /** IDs of other milindDocs that this doc @mentions */
  links: string[];
  /** Position in the graph view */
  graphPos?: { x: number; y: number };
  /** Custom color for the graph node */
  nodeColor?: string;
  /** Manually drawn connections to other doc IDs (distinct from @mention links) */
  graphLinks?: string[];
  /** True when this doc was auto-created from a calendar event description */
  autoCreatedFromCalendar?: boolean;

  /* ── Task facet ──────────────────────────────────────────────────
   * A doc with a completion state also appears on the task board. Same
   * record, second view — no linked copy. */
  completed?: boolean;
  importance?: TaskImportance;
  dueDate?: string;
  columnId?: string;

  /** Sheet facet — same meaning as on Task. */
  sheet?: SheetData;
}

export interface PanelNote {
  id: string;
  text: string;
  color: string;
  createdAt: number;
}

export type TaskImportance = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: number;
  importance: TaskImportance;
  dueDate?: string; // ISO date string YYYY-MM-DD
  assigneeEmail?: string;
  /** Custom kanban column id — overrides importance-based placement */
  columnId?: string;
  /** When set, the task is visually attached to this event key (calendarId::eventId) on the canvas */
  attachedToEventKey?: string;
  /** Canvas position for free-floating tasks */
  canvasPos?: { x: number; y: number };
  /** Asana task GID — present when the task is synced from Asana */
  asanaGid?: string;
  /** Asana project name the task belongs to */
  asanaProjectName?: string;
  /** Display name of the Asana assignee */
  asanaAssigneeName?: string;
  /** Origin of the task — "local" (default) or "asana" */
  source?: "local" | "asana";

  /* ── Calendar facet ──────────────────────────────────────────────
   * A task with a start time *is* a calendar entry. It is not converted
   * into one and it does not get a linked copy — the same record simply
   * renders in both places. Dropping a task on the calendar writes these
   * three fields and nothing else. See lib/record.ts for the model these
   * are the first step toward. */

  /** ISO timestamp. Present means this task also appears on the calendar. */
  start?: string;
  end?: string;
  allDay?: boolean;

  /* ── Doc facet ───────────────────────────────────────────────────
   * Rich body content. Present means this same record also opens in the
   * milindDocs editor — it is not converted into a doc and gets no linked
   * copy. Tiptap JSON, same shape as MilindDocFile.content. */
  body?: Record<string, unknown> | null;

  /* ── Sheet facet ─────────────────────────────────────────────────
   * Present means this same record also opens in the grid. Cells are
   * sparse A1-keyed raw strings; see lib/sheet.ts. */
  sheet?: SheetData;
}

export interface KanbanColumn {
  id: string;
  label: string;
  color: string;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "high",   label: "High",   color: "#ef4444" },
  { id: "medium", label: "Medium", color: "#f59e0b" },
  { id: "low",    label: "Low",    color: "#6b7280" },
  { id: "done",   label: "Done",   color: "#10b981" },
];

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  to: string;
  cc?: string;
  body: string;
  htmlBody?: string;
}

export interface GmailContact {
  name: string;
  email: string;
}
