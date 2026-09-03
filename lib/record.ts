/**
 * The one record.
 *
 * milindCal's premise is that a calendar event, a task, a doc and a sheet are
 * not four things — they are one thing wearing four faces. A task dragged onto
 * the calendar should not become a *new* event; it should be the same record
 * that now happens to have a start time. A doc is that record with rich body
 * content. A task is that record with a completion state.
 *
 * So there is no `kind` discriminator here on purpose. What a record *is* is
 * derived from which fields it carries:
 *
 *   start      present -> it renders on the calendar
 *   status     present -> it renders on the task board
 *   body       present -> it opens in the docs editor
 *   sheet      present -> it opens in the grid
 *
 * These are not exclusive. A record can be all four at once, and that is the
 * point: the same thing, shown differently. Cross-view drag becomes a field
 * write (`schedule()`, `makeActionable()`), never a create-and-link.
 *
 * Legacy note: the app previously modelled Task / MilindDocFile / CalendarEvent
 * as three separate types across three separate stores, and every cross-view
 * drop duplicated data into a new entity joined by a link edge. The adapters at
 * the bottom of this file translate to and from those shapes so the migration
 * can happen view by view without a flag day.
 */

import type { CalendarEvent, MilindDocFile, Task, TaskImportance } from "./models";

/** Tiptap document JSON. Deliberately loose — we never introspect it here. */
export type RichBody = Record<string, unknown>;

/**
 * Which view the record was last authored in. This is a *presentation hint*
 * for where to open it by default and which icon to show — never a type, and
 * never a gate on what a record can do.
 */
export type ViewAffinity = "calendar" | "task" | "doc" | "sheet";

export type RecordStatus = "open" | "done";

/** Where a scheduled record is mirrored in Google Calendar. Google holds a
 *  projection of the record, not the record itself. */
export interface GoogleProjection {
  calendarId: string;
  eventId: string;
  /** Google's per-event version tag — an O(1) "has this changed?" check. */
  etag?: string;
}

export interface MilindRecord {
  id: string;
  title: string;

  /* ── Facets. Presence, not type, decides how this renders. ────────── */

  /** Rich content. Non-null means it opens in the docs editor. */
  body: RichBody | null;

  /** ISO timestamp. Present means it appears on the calendar. */
  start?: string;
  end?: string;
  allDay?: boolean;

  /** Present means it appears on the task board. */
  status?: RecordStatus;
  importance?: TaskImportance;
  /** YYYY-MM-DD. A soft deadline, distinct from `start` (a scheduled slot). */
  dueDate?: string;

  /* ── Metadata ─────────────────────────────────────────────────────── */

  createdAt: number;
  updatedAt: number;
  affinity: ViewAffinity;

  /** Plain-text summary. Kept alongside `body` because Google Calendar
   *  descriptions and task subtitles are plain text, and re-flattening the
   *  Tiptap tree on every render is wasteful. */
  summary?: string;

  location?: string;
  attendees?: string[];
  color?: string;

  google?: GoogleProjection;

  /* ── Cross-record edges ───────────────────────────────────────────── */

  /** Ids of other records this one references. Symmetric edges are
   *  maintained by the store. */
  links: string[];

  /* ── Per-view presentation state ──────────────────────────────────── */

  /** Kanban column override; falls back to `importance` when unset. */
  columnId?: string;
  canvasPos?: { x: number; y: number };
  graphPos?: { x: number; y: number };
  nodeColor?: string;

  /* ── Provenance ───────────────────────────────────────────────────── */

  source?: "local" | "asana";
  asanaGid?: string;
  asanaProjectName?: string;
  asanaAssigneeName?: string;
}

/* ── Facet predicates ─────────────────────────────────────────────────
 *
 * Read these instead of checking a kind. `isScheduled(r)` is the honest
 * question — "does this belong on the calendar?" — where `r.kind === "event"`
 * was a lie the moment the same thing also needed to be a task.
 */

export const isScheduled = (r: MilindRecord): boolean => Boolean(r.start);
export const isActionable = (r: MilindRecord): boolean => r.status !== undefined;
export const hasBody = (r: MilindRecord): boolean => r.body !== null && r.body !== undefined;
export const isDone = (r: MilindRecord): boolean => r.status === "done";

/** Every view a record currently qualifies for. A record with a start time,
 *  a status and a body legitimately appears in all three. */
export function facetsOf(r: MilindRecord): ViewAffinity[] {
  const out: ViewAffinity[] = [];
  if (isScheduled(r)) out.push("calendar");
  if (isActionable(r)) out.push("task");
  if (hasBody(r)) out.push("doc");
  return out;
}

/* ── Facet transitions ────────────────────────────────────────────────
 *
 * These are what cross-view drag actually does. Each returns a patch to
 * merge into the record — nothing here creates a new record, which is the
 * whole distinction from the old create-and-link behaviour.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Give a record a place on the calendar. Idempotent: re-dropping a record
 *  that is already scheduled just moves it. */
export function schedule(
  start: string,
  end?: string,
  allDay = false,
): Partial<MilindRecord> {
  return {
    start,
    end: end ?? new Date(new Date(start).getTime() + HOUR_MS).toISOString(),
    allDay,
    updatedAt: Date.now(),
  };
}

/** Remove a record from the calendar without deleting it — it keeps every
 *  other facet it had. */
export function unschedule(): Partial<MilindRecord> {
  return { start: undefined, end: undefined, allDay: undefined, updatedAt: Date.now() };
}

/** Put a record on the task board. Preserves an existing status so dragging a
 *  finished task around doesn't silently reopen it. */
export function makeActionable(
  r: MilindRecord,
  columnId?: string,
): Partial<MilindRecord> {
  return {
    status: r.status ?? "open",
    importance: r.importance ?? "medium",
    ...(columnId ? { columnId } : {}),
    updatedAt: Date.now(),
  };
}

/** Give a record body content so it opens in the editor. Seeds from the
 *  plain-text summary the first time, so a task dragged into docs arrives
 *  with its description already written. */
export function ensureBody(r: MilindRecord): Partial<MilindRecord> {
  if (hasBody(r)) return {};
  const text = r.summary?.trim();
  return {
    body: text
      ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
      : { type: "doc", content: [] },
    updatedAt: Date.now(),
  };
}

/** The patch that a drop onto `target` implies for `record`. Returning an
 *  empty object means the drop is a no-op — the record already has that
 *  facet, so there is nothing to change. */
export function facetPatch(
  record: MilindRecord,
  target: ViewAffinity,
  hint?: { start?: string; end?: string; allDay?: boolean; columnId?: string },
): Partial<MilindRecord> {
  switch (target) {
    case "calendar":
      return schedule(
        hint?.start ?? new Date().toISOString(),
        hint?.end,
        hint?.allDay ?? false,
      );
    case "task":
      return makeActionable(record, hint?.columnId);
    case "doc":
      return ensureBody(record);
    default:
      return {};
  }
}

/* ── Adapters to and from the legacy shapes ───────────────────────────
 *
 * Temporary, and deliberately lossless in the directions that matter, so
 * views can migrate one at a time. Delete these once every view reads
 * MilindRecord directly.
 */

export function recordFromTask(t: Task): MilindRecord {
  return {
    id: t.id,
    title: t.title,
    body: null,
    summary: t.description,
    status: t.completed ? "done" : "open",
    importance: t.importance,
    dueDate: t.dueDate,
    columnId: t.columnId,
    canvasPos: t.canvasPos,
    createdAt: t.createdAt,
    updatedAt: t.createdAt,
    affinity: "task",
    links: [],
    source: t.source,
    asanaGid: t.asanaGid,
    asanaProjectName: t.asanaProjectName,
    asanaAssigneeName: t.asanaAssigneeName,
  };
}

export function taskFromRecord(r: MilindRecord): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.summary,
    completed: isDone(r),
    createdAt: r.createdAt,
    importance: r.importance ?? "medium",
    dueDate: r.dueDate,
    columnId: r.columnId,
    canvasPos: r.canvasPos,
    source: r.source,
    asanaGid: r.asanaGid,
    asanaProjectName: r.asanaProjectName,
    asanaAssigneeName: r.asanaAssigneeName,
  };
}

export function recordFromDoc(d: MilindDocFile): MilindRecord {
  const meta = d.calendarMeta;
  return {
    id: d.id,
    title: d.title,
    body: d.content,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    affinity: "doc",
    links: d.links ?? [],
    graphPos: d.graphPos,
    nodeColor: d.nodeColor,
    // A doc converted from an event already carried its schedule in
    // calendarMeta — in the unified model that is simply the record's own
    // start/end plus its Google projection.
    ...(meta
      ? {
          start: meta.start,
          end: meta.end,
          allDay: meta.allDay,
          location: meta.location,
          summary: meta.description,
          google: { calendarId: meta.calendarId, eventId: meta.eventId },
        }
      : {}),
  };
}

export function docFromRecord(r: MilindRecord): MilindDocFile {
  return {
    id: r.id,
    title: r.title,
    content: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    links: r.links,
    graphPos: r.graphPos,
    nodeColor: r.nodeColor,
    ...(r.google && r.start && r.end
      ? {
          calendarMeta: {
            eventId: r.google.eventId,
            calendarId: r.google.calendarId,
            title: r.title,
            start: r.start,
            end: r.end,
            description: r.summary,
            location: r.location,
            allDay: r.allDay ?? false,
          },
        }
      : {}),
  };
}

export function recordFromEvent(e: CalendarEvent): MilindRecord {
  return {
    id: e.id,
    title: e.title,
    body: null,
    summary: e.description,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    location: e.location,
    attendees: e.attendees,
    color: e.color,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    affinity: "calendar",
    links: [],
    google: { calendarId: e.calendarId, eventId: e.id, etag: e.etag },
  };
}
