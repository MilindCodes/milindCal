/**
 * Unified entity model for milindCal.
 *
 * Events, Tasks, and Docs are different *shapes* of the same underlying
 * idea: a piece of intent with optional time, optional completion, and
 * optional rich content. We can't fully unify the data model because
 * calendar events live in Google, but we can give every entity a uniform
 * key and a shared link graph so cross-view drag/drop and backlinks work.
 */

import type { CalendarEvent, MilindDocFile, Task } from "./models";

export type EntityKind = "event" | "task" | "doc" | "sheet";

/** `"event:abc123"` — stable, URL-safe identifier across entity kinds. */
export type EntityKey = `${EntityKind}:${string}`;

export function entityKey(kind: EntityKind, id: string): EntityKey {
  return `${kind}:${id}` as EntityKey;
}

export function parseEntityKey(key: string): { kind: EntityKind; id: string } | null {
  const idx = key.indexOf(":");
  if (idx === -1) return null;
  const kind = key.slice(0, idx) as EntityKind;
  const id = key.slice(idx + 1);
  if (kind !== "event" && kind !== "task" && kind !== "doc" && kind !== "sheet") return null;
  if (!id) return null;
  return { kind, id };
}

/** Event keys are scoped by calendarId because Google event IDs are only
 *  unique within a calendar. */
export function eventKey(calendarId: string, eventId: string): EntityKey {
  return entityKey("event", `${calendarId}::${eventId}`);
}

export function parseEventId(idPart: string): { calendarId: string; eventId: string } | null {
  const sep = idPart.indexOf("::");
  if (sep === -1) return null;
  return { calendarId: idPart.slice(0, sep), eventId: idPart.slice(sep + 2) };
}

/** Adjacency list: each key → array of keys it links to. Links are directed,
 *  but we render backlinks by scanning the full graph. */
export type LinkGraph = Record<string, string[]>;

export const LINKS_STORAGE_KEY = "milindcal.links.v1";

export function addEdge(graph: LinkGraph, from: EntityKey, to: EntityKey): LinkGraph {
  if (from === to) return graph;
  const existing = graph[from] ?? [];
  if (existing.includes(to)) return graph;
  return { ...graph, [from]: [...existing, to] };
}

export function removeEdge(graph: LinkGraph, from: EntityKey, to: EntityKey): LinkGraph {
  const existing = graph[from];
  if (!existing || !existing.includes(to)) return graph;
  const next = existing.filter((k) => k !== to);
  if (next.length === 0) {
    const { [from]: _dropped, ...rest } = graph;
    void _dropped;
    return rest;
  }
  return { ...graph, [from]: next };
}

const reverseIndexCache = new WeakMap<LinkGraph, Record<string, string[]>>();

function getReverseIndex(graph: LinkGraph): Record<string, string[]> {
  let rev = reverseIndexCache.get(graph);
  if (!rev) {
    rev = {};
    for (const [from, tos] of Object.entries(graph)) {
      for (const to of tos) {
        if (!rev[to]) rev[to] = [];
        if (!rev[to].includes(from)) rev[to].push(from);
      }
    }
    reverseIndexCache.set(graph, rev);
  }
  return rev;
}

/** Undirected neighbors: union of out-edges from `key` and in-edges to `key`. */
export function neighbors(graph: LinkGraph, key: EntityKey): EntityKey[] {
  const outKeys = graph[key] ?? [];
  const inKeys = getReverseIndex(graph)[key] ?? [];

  if (outKeys.length === 0) return inKeys as EntityKey[];
  if (inKeys.length === 0) return outKeys as EntityKey[];

  const out = new Set<string>(outKeys);
  for (const k of inKeys) out.add(k);
  return [...out] as EntityKey[];
}

/** Universal drag payload — every draggable thing in the app speaks this. */
export interface UniversalDragPayload {
  kind: EntityKind;
  id: string;
  /** For events we carry the calendarId so the drop handler can address Google. */
  calendarId?: string;
  /** Human label — used when converting to a new entity (e.g. task → event title). */
  label: string;
  /** Optional rich description used when converting task ↔ doc or task → event. */
  description?: string;
}

export function payloadFromTask(task: Task): UniversalDragPayload {
  return {
    kind: "task",
    id: task.id,
    label: task.title,
    description: task.description,
  };
}

export function payloadFromDoc(doc: MilindDocFile): UniversalDragPayload {
  return {
    kind: "doc",
    id: doc.id,
    label: doc.title || "Untitled",
  };
}

export function payloadFromEvent(event: CalendarEvent): UniversalDragPayload {
  return {
    kind: "event",
    id: event.id,
    calendarId: event.calendarId,
    label: event.title,
    description: event.description,
  };
}

export function payloadKey(p: UniversalDragPayload): EntityKey {
  if (p.kind === "event" && p.calendarId) return eventKey(p.calendarId, p.id);
  return entityKey(p.kind, p.id);
}
