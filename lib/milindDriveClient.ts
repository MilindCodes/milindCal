/**
 * milindDriveClient
 *
 * Typed fetch wrapper for the milindDrive backend API.
 *
 * Auth: milindDrive's /api/* routes use requireGoogleAuth middleware, which
 * accepts the same Google OAuth access token that NextAuth already puts in
 * session.accessToken.  No separate login or JWT is needed — the two apps
 * share the same Google identity.
 *
 * Base URL: set NEXT_PUBLIC_MILIND_DRIVE_URL in .env.local (e.g. http://localhost:4000).
 */

import type { MilindDocFile, Task } from "./models";
import type { LinkGraph } from "./entity-store";

const BASE_URL =
  process.env.NEXT_PUBLIC_MILIND_DRIVE_URL ?? "http://localhost:4000";

// ── Core fetch helper ────────────────────────────────────────────

async function driveRequest<T>(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `milindDrive ${options?.method ?? "GET"} ${path} → ${res.status}: ${text}`,
    );
  }
  return res.json() as Promise<T>;
}

// ── Shape normalisers ────────────────────────────────────────────
// milindDrive sends null for absent optional fields; MilindDocFile / Task
// expect undefined.  These convert the wire shape to local types.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDocFile(d: any): MilindDocFile {
  return {
    id: d.id,
    title: d.title ?? "Untitled",
    content: d.content ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    calendarMeta: d.calendarMeta ?? undefined,
    links: d.links ?? [],
    graphLinks: d.graphLinks?.length ? d.graphLinks : undefined,
    graphPos: d.graphPos ?? undefined,
    nodeColor: d.nodeColor ?? undefined,
    autoCreatedFromCalendar: d.autoCreatedFromCalendar ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTask(t: any): Task {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? undefined,
    completed: t.completed,
    createdAt: t.createdAt,
    importance: t.importance,
    dueDate: t.dueDate ?? undefined,
    assigneeEmail: t.assigneeEmail ?? undefined,
    columnId: t.columnId ?? undefined,
    attachedToEventKey: t.attachedToEventKey ?? undefined,
    canvasPos: t.canvasPos ?? undefined,
    asanaGid: t.asanaGid ?? undefined,
    asanaProjectName: t.asanaProjectName ?? undefined,
    asanaAssigneeName: t.asanaAssigneeName ?? undefined,
    source: t.source ?? "local",
  };
}

// ── Docs API ─────────────────────────────────────────────────────

export async function fetchDocs(token: string): Promise<MilindDocFile[]> {
  const data = await driveRequest<{ docs: unknown[] }>(
    token,
    "/api/docs?limit=500",
  );
  return data.docs.map(toDocFile);
}

export async function fetchDoc(
  token: string,
  id: string,
): Promise<MilindDocFile> {
  const d = await driveRequest<unknown>(token, `/api/docs/${id}`);
  return toDocFile(d);
}

export async function createDoc(
  token: string,
  doc: MilindDocFile,
): Promise<MilindDocFile> {
  const d = await driveRequest<unknown>(token, "/api/docs", {
    method: "POST",
    body: JSON.stringify({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      calendarMeta: doc.calendarMeta ?? null,
      links: doc.links,
      graphLinks: doc.graphLinks ?? [],
      graphPos: doc.graphPos ?? null,
      nodeColor: doc.nodeColor ?? null,
      autoCreatedFromCalendar: doc.autoCreatedFromCalendar ?? false,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }),
  });
  return toDocFile(d);
}

export async function patchDoc(
  token: string,
  id: string,
  patch: Partial<MilindDocFile>,
): Promise<MilindDocFile> {
  // Only send fields the server understands; skip id / createdAt / updatedAt.
  //
  // We check `"field" in patch` rather than `patch.field !== undefined` —
  // callers legitimately clear optional fields with `{ field: undefined }`
  // (e.g. detaching a doc's calendarMeta), and object spread/literals keep
  // that as an own property. `!== undefined` can't tell "not touched" apart
  // from "explicitly cleared", so it would silently drop clears instead of
  // forwarding them as `null`.
  const body: Record<string, unknown> = {};
  if ("title" in patch) body.title = patch.title;
  if ("content" in patch) body.content = patch.content;
  if ("calendarMeta" in patch) body.calendarMeta = patch.calendarMeta ?? null;
  if ("links" in patch) body.links = patch.links;
  if ("graphLinks" in patch) body.graphLinks = patch.graphLinks ?? [];
  if ("graphPos" in patch) body.graphPos = patch.graphPos ?? null;
  if ("nodeColor" in patch) body.nodeColor = patch.nodeColor ?? null;
  if ("autoCreatedFromCalendar" in patch)
    body.autoCreatedFromCalendar = patch.autoCreatedFromCalendar;

  const d = await driveRequest<unknown>(token, `/api/docs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return toDocFile(d);
}

export async function deleteDoc(token: string, id: string): Promise<void> {
  await driveRequest<{ success: boolean }>(token, `/api/docs/${id}`, {
    method: "DELETE",
  });
}

export async function batchUpsertDocs(
  token: string,
  docs: MilindDocFile[],
): Promise<MilindDocFile[]> {
  const data = await driveRequest<{ docs: unknown[] }>(
    token,
    "/api/docs/batch",
    {
      method: "POST",
      body: JSON.stringify({
        docs: docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          calendarMeta: doc.calendarMeta ?? null,
          links: doc.links,
          graphLinks: doc.graphLinks ?? [],
          graphPos: doc.graphPos ?? null,
          nodeColor: doc.nodeColor ?? null,
          autoCreatedFromCalendar: doc.autoCreatedFromCalendar ?? false,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })),
      }),
    },
  );
  return data.docs.map(toDocFile);
}

// ── Tasks API ─────────────────────────────────────────────────────

export async function fetchTasks(token: string): Promise<Task[]> {
  const data = await driveRequest<{ tasks: unknown[] }>(token, "/api/tasks");
  return data.tasks.map(toTask);
}

export async function createTask(
  token: string,
  task: Task,
): Promise<Task> {
  const t = await driveRequest<unknown>(token, "/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      id: task.id,
      title: task.title,
      description: task.description ?? null,
      completed: task.completed,
      importance: task.importance,
      dueDate: task.dueDate ?? null,
      assigneeEmail: task.assigneeEmail ?? null,
      columnId: task.columnId ?? null,
      attachedToEventKey: task.attachedToEventKey ?? null,
      canvasPos: task.canvasPos ?? null,
      asanaGid: task.asanaGid ?? null,
      asanaProjectName: task.asanaProjectName ?? null,
      asanaAssigneeName: task.asanaAssigneeName ?? null,
      source: task.source ?? "local",
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    }),
  });
  return toTask(t);
}

export async function patchTask(
  token: string,
  id: string,
  patch: Partial<Task>,
): Promise<Task> {
  // See the comment in patchDoc: "field" in patch (not !== undefined) so an
  // explicit clear (e.g. { canvasPos: undefined } when detaching a task from
  // the canvas) is forwarded to the server as null instead of silently dropped.
  const body: Record<string, unknown> = {};
  if ("title" in patch) body.title = patch.title;
  if ("description" in patch) body.description = patch.description ?? null;
  if ("completed" in patch) body.completed = patch.completed;
  if ("importance" in patch) body.importance = patch.importance;
  if ("dueDate" in patch) body.dueDate = patch.dueDate ?? null;
  if ("assigneeEmail" in patch) body.assigneeEmail = patch.assigneeEmail ?? null;
  if ("columnId" in patch) body.columnId = patch.columnId ?? null;
  if ("attachedToEventKey" in patch)
    body.attachedToEventKey = patch.attachedToEventKey ?? null;
  if ("canvasPos" in patch) body.canvasPos = patch.canvasPos ?? null;
  if ("asanaGid" in patch) body.asanaGid = patch.asanaGid ?? null;
  if ("asanaProjectName" in patch)
    body.asanaProjectName = patch.asanaProjectName ?? null;
  if ("asanaAssigneeName" in patch)
    body.asanaAssigneeName = patch.asanaAssigneeName ?? null;
  if ("source" in patch) body.source = patch.source;

  const t = await driveRequest<unknown>(token, `/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return toTask(t);
}

export async function deleteTask(token: string, id: string): Promise<void> {
  await driveRequest<{ success: boolean }>(token, `/api/tasks/${id}`, {
    method: "DELETE",
  });
}

export async function batchUpsertTasks(
  token: string,
  tasks: Task[],
): Promise<Task[]> {
  const data = await driveRequest<{ tasks: unknown[] }>(
    token,
    "/api/tasks/batch",
    {
      method: "POST",
      body: JSON.stringify({
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description ?? null,
          completed: task.completed,
          importance: task.importance,
          dueDate: task.dueDate ?? null,
          assigneeEmail: task.assigneeEmail ?? null,
          columnId: task.columnId ?? null,
          attachedToEventKey: task.attachedToEventKey ?? null,
          canvasPos: task.canvasPos ?? null,
          asanaGid: task.asanaGid ?? null,
          asanaProjectName: task.asanaProjectName ?? null,
          asanaAssigneeName: task.asanaAssigneeName ?? null,
          source: task.source ?? "local",
          createdAt: task.createdAt,
          updatedAt: task.createdAt,
        })),
      }),
    },
  );
  return data.tasks.map(toTask);
}

// ── Links API ─────────────────────────────────────────────────────

export async function fetchLinks(token: string): Promise<LinkGraph> {
  const data = await driveRequest<{ graph: LinkGraph }>(token, "/api/links");
  return data.graph;
}

export async function addLink(
  token: string,
  from: string,
  to: string,
): Promise<void> {
  await driveRequest<{ success: boolean }>(token, "/api/links", {
    method: "POST",
    body: JSON.stringify({ from, to }),
  });
}

export async function removeLink(
  token: string,
  from: string,
  to: string,
): Promise<void> {
  await driveRequest<{ success: boolean }>(token, "/api/links", {
    method: "DELETE",
    body: JSON.stringify({ from, to }),
  });
}

export async function batchLinks(
  token: string,
  graph: LinkGraph,
): Promise<LinkGraph> {
  // Flatten the adjacency list to edge pairs for the batch endpoint.
  const links: Array<{ from: string; to: string }> = [];
  for (const [from, tos] of Object.entries(graph)) {
    for (const to of tos) {
      links.push({ from, to });
    }
  }
  const data = await driveRequest<{ graph: LinkGraph }>(
    token,
    "/api/links/batch",
    {
      method: "POST",
      body: JSON.stringify({ links }),
    },
  );
  return data.graph;
}
