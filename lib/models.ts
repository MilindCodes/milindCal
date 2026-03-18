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

export const TASK_STORAGE_KEY = "milindcal.tasks.v1";
export const KANBAN_COLUMNS_KEY = "milindcal.kanban.columns.v1";
export const DOCS_KEY = "milindcal.docs.current.v1";
export const PANEL_NOTES_KEY = "milindcal.panel.notes.v1";
export const CANVAS_PENDING_NOTE_KEY = "milindcal.canvas.pending-note";

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
  body: string;
  htmlBody?: string;
}
