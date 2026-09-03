"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { readJSON, writeBatched } from "@/lib/batched-storage";
import {
  LINKS_STORAGE_KEY,
  addEdge,
  entityKey,
  neighbors,
  parseEntityKey,
  removeEdge,
  type EntityKey,
  type EntityKind,
  type LinkGraph,
} from "@/lib/entity-store";
import {
  DOCS_LIBRARY_KEY,
  TASK_STORAGE_KEY,
  type MilindDocFile,
  type Task,
} from "@/lib/models";
import {
  recordFromDoc,
  recordFromTask,
  type MilindRecord,
} from "@/lib/record";
import {
  fetchDocs,
  fetchTasks,
  fetchLinks,
  createDoc as driveCreateDoc,
  patchDoc as drivePatchDoc,
  deleteDoc as driveDeleteDoc,
  batchUpsertDocs,
  createTask as driveCreateTask,
  patchTask as drivePatchTask,
  deleteTask as driveDeleteTask,
  batchUpsertTasks,
  addLink as driveAddLink,
  removeLink as driveRemoveLink,
  batchLinks as driveBatchLinks,
} from "@/lib/milindDriveClient";

/**
 * localStorage key written once after the first successful migration so we
 * never re-push local data to milindDrive on subsequent loads.
 */
const MIGRATION_FLAG = "milindcal.migrated_to_drive.v1";

/**
 * Local rescue for facets the server cannot store yet.
 *
 * milindDrive's task and doc routes predate the record model, so several
 * fields are dropped on save — their Zod schemas have no `.passthrough()`.
 * Some facets survive anyway because they have somewhere else to live: a
 * doc's schedule rides in `calendarMeta`, a doc's body in `content`, a task's
 * completion in its own column. These do not:
 *
 *   on a task   start, end, allDay, body, sheet, googleEventId, googleCalendarId
 *   on a doc    completed, importance, dueDate, columnId, sheet
 *
 * Without this, scheduling a task, adopting a calendar event, putting a doc on
 * the board, or typing into a spreadsheet all appear to work and are gone by
 * the next reload.
 *
 * The server stays authoritative: a rescued value is applied only where the
 * server returned nothing for that field, on a record it already knows about.
 * So the moment milindDrive gains the columns
 * (docs/milinddrive-facet-persistence.patch.md) the server wins on every read,
 * this stops being consulted, and the whole block can be deleted.
 *
 * The limit, stated plainly: it is per-device. It stops you losing work on
 * reload; it does not sync. A floor under the data loss, not a substitute for
 * the backend fix.
 */
const FACET_RESCUE_KEY = "milindcal.facets.rescue.v1";

const RESCUED_TASK_FIELDS = [
  "start", "end", "allDay", "body", "sheet", "googleEventId", "googleCalendarId",
] as const;
const RESCUED_DOC_FIELDS = [
  "completed", "importance", "dueDate", "columnId", "sheet",
] as const;

type FacetRescue = Record<string, Record<string, unknown>>;

function readFacetRescue(): FacetRescue {
  return readJSON<FacetRescue>(FACET_RESCUE_KEY, {});
}

/** Merge the rescuable parts of a patch into the mirror. An explicit null or
 *  undefined forgets that field, so a cleared facet cannot come back. */
function writeFacetRescue(
  id: string,
  patch: Record<string, unknown>,
  fields: readonly string[],
): void {
  const rescue = readFacetRescue();
  const entry: Record<string, unknown> = { ...(rescue[id] ?? {}) };
  let touched = false;
  for (const f of fields) {
    if (!(f in patch)) continue;
    touched = true;
    const v = patch[f];
    if (v === undefined || v === null) delete entry[f];
    else entry[f] = v;
  }
  if (!touched) return;
  if (Object.keys(entry).length === 0) delete rescue[id];
  else rescue[id] = entry;
  writeBatched(FACET_RESCUE_KEY, rescue);
}

function forgetFacetRescue(id: string): void {
  const rescue = readFacetRescue();
  if (rescue[id] === undefined) return;
  delete rescue[id];
  writeBatched(FACET_RESCUE_KEY, rescue);
}

/** Re-attach locally-held facets to records the server returned without them. */
function restoreFacets<T extends { id: string }>(
  records: T[],
  fields: readonly string[],
): T[] {
  const rescue = readFacetRescue();
  if (Object.keys(rescue).length === 0) return records;
  let restored = 0;
  const out = records.map((r) => {
    const entry = rescue[r.id];
    if (!entry) return r;
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      // Fill a genuine gap only — never override what the server sent.
      if (entry[f] !== undefined && (r as Record<string, unknown>)[f] === undefined) {
        patch[f] = entry[f];
      }
    }
    if (Object.keys(patch).length === 0) return r;
    restored++;
    return { ...r, ...patch };
  });
  if (restored > 0) {
    console.warn(
      `[milindCal] Restored facets on ${restored} record(s) from local storage — ` +
        "the server is not persisting them yet, so they exist only on this device. " +
        "See docs/milinddrive-facet-persistence.patch.md.",
    );
  }
  return out;
}

interface EntityActions {
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  addTask: (task: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;

  setDocs: React.Dispatch<React.SetStateAction<MilindDocFile[]>>;
  addDoc: (doc: MilindDocFile) => void;
  updateDoc: (id: string, patch: Partial<MilindDocFile>) => void;
  deleteDoc: (id: string) => void;

  setLinks: React.Dispatch<React.SetStateAction<LinkGraph>>;
  link: (from: EntityKey, to: EntityKey) => void;
  unlink: (from: EntityKey, to: EntityKey) => void;

  resolveLabel: (key: EntityKey) => string;
  registerLabelResolver: (kind: EntityKind, resolver: (id: string) => string | undefined) => () => void;

  pendingOpenDocId: string | null;
  openAsDoc: (key: EntityKey, seed?: { title?: string; description?: string }) => string | null;
  clearPendingOpenDoc: () => void;

  /** Patch a record without caring which store backs it.
   *
   *  Tasks and docs still live in two tables, but that is storage detail —
   *  callers work with one record space. This resolves the id to whichever
   *  list holds it and applies the patch there, so a facet transition
   *  (schedule / makeActionable / ensureBody) is a single call regardless of
   *  where the record originated. Returns false when the id is unknown. */
  updateRecord: (id: string, patch: Partial<MilindRecord>) => boolean;

  /** True when the Google OAuth refresh token has expired/been revoked.
   *  The user must re-authenticate to restore milindDrive sync. */
  driveAuthError: boolean;
}

const TasksContext = createContext<Task[] | null>(null);
const DocsContext = createContext<MilindDocFile[] | null>(null);
const LinksContext = createContext<LinkGraph | null>(null);
const RecordsContext = createContext<MilindRecord[] | null>(null);
const EntityActionsContext = createContext<EntityActions | null>(null);

export function EntityStoreProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();

  /* Start with empty state on both server and first client render so
   * hydration matches.  Real data is loaded in a post-mount effect. */
  const [tasks, setTasks] = useState<Task[]>([]);
  const [docs, setDocs] = useState<MilindDocFile[]>([]);
  const [links, setLinks] = useState<LinkGraph>({});
  const [hydrated, setHydrated] = useState(false);
  const [driveAuthError, setDriveAuthError] = useState(false);

  /* External label resolvers (events live in Google, outside this store). */
  const resolverRefs = useRef<Partial<Record<EntityKind, (id: string) => string | undefined>>>({});

  /* Stable refs for use inside useCallback without stale closures. */
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const docsRef = useRef(docs);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  const linksRef = useRef(links);
  useEffect(() => { linksRef.current = links; }, [links]);

  /* Always-current Google access token — updated whenever the session
   * changes (token refresh, sign-out, etc.). */
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = (session?.accessToken as string | undefined) ?? null;
  }, [session?.accessToken]);

  /* Track whether we have already hydrated from milindDrive so a token
   * refresh doesn't wipe and re-fetch the in-memory state. */
  const hydratedFromDriveRef = useRef(false);

  /* Debounce timers + pending patch accumulator for doc content updates.
   * Doc content can change on every keystroke; we batch and send once per
   * 800ms window so the API isn't flooded while the user types. */
  const docPatchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const docPendingPatches = useRef(new Map<string, Partial<MilindDocFile>>());

  // ── Hydration ─────────────────────────────────────────────────────
  // Runs whenever session status resolves.  Three outcomes:
  //   1. No token  → fall back to localStorage (dev bypass / signed out)
  //   2. Token, first run → one-time migration then fetch from milindDrive
  //   3. Token, subsequent runs (token refresh) → skip, state is live

  useEffect(() => {
    if (status === "loading") return;

    // When NextAuth can't refresh the Google token (e.g. refresh token revoked
    // after laptop sleep / long inactivity), the session still exists but the
    // access token is stale.  Detect this early so we don't burn an API call
    // that will 401, and surface it to the UI so the user can re-auth.
    if (session?.error === "RefreshAccessTokenError") {
      setDriveAuthError(true);
      if (!hydratedFromDriveRef.current && !hydrated) {
        setTasks(readJSON<Task[]>(TASK_STORAGE_KEY, []));
        setDocs(readJSON<MilindDocFile[]>(DOCS_LIBRARY_KEY, []));
        setLinks(readJSON<LinkGraph>(LINKS_STORAGE_KEY, {}));
        setHydrated(true);
      }
      return;
    }

    setDriveAuthError(false);

    const token = (session?.accessToken as string | undefined) ?? null;

    if (!token) {
      if (!hydratedFromDriveRef.current && !hydrated) {
        // Dev auth bypass or signed out — use localStorage as before.
        setTasks(readJSON<Task[]>(TASK_STORAGE_KEY, []));
        setDocs(readJSON<MilindDocFile[]>(DOCS_LIBRARY_KEY, []));
        setLinks(readJSON<LinkGraph>(LINKS_STORAGE_KEY, {}));
        setHydrated(true);
      }
      return;
    }

    if (hydratedFromDriveRef.current) return; // already live — skip
    hydratedFromDriveRef.current = true;

    async function hydrate(t: string) {
      // ── One-time localStorage → milindDrive migration ──────────
      const alreadyMigrated =
        typeof window !== "undefined"
          ? window.localStorage.getItem(MIGRATION_FLAG)
          : "1"; // treat SSR as already migrated

      if (!alreadyMigrated) {
        const localTasks = readJSON<Task[]>(TASK_STORAGE_KEY, []);
        const localDocs = readJSON<MilindDocFile[]>(DOCS_LIBRARY_KEY, []);
        const localLinks = readJSON<LinkGraph>(LINKS_STORAGE_KEY, {});

        const work: Promise<unknown>[] = [];

        const tasksToMigrate = localTasks.filter((tk) => tk.source !== "asana");
        if (tasksToMigrate.length > 0) {
          work.push(batchUpsertTasks(t, tasksToMigrate).catch(console.error));
        }
        if (localDocs.length > 0) {
          work.push(batchUpsertDocs(t, localDocs).catch(console.error));
        }
        if (Object.keys(localLinks).length > 0) {
          work.push(driveBatchLinks(t, localLinks).catch(console.error));
        }

        await Promise.all(work);
        window.localStorage.setItem(MIGRATION_FLAG, "1");
      }

      // ── Fetch authoritative state from milindDrive ─────────────
      const [remoteTasks, remoteDocs, remoteLinks] = await Promise.all([
        fetchTasks(t),
        fetchDocs(t),
        fetchLinks(t),
      ]);

      // Re-attach any sheets the server dropped. No-op once it persists them.
      setTasks(restoreFacets(remoteTasks, RESCUED_TASK_FIELDS));
      setDocs(restoreFacets(remoteDocs, RESCUED_DOC_FIELDS));
      setLinks(remoteLinks);
      setHydrated(true);
    }

    hydrate(token).catch((err) => {
      console.error("[milindDrive] hydration failed — falling back to localStorage:", err);
      // Graceful degradation: let the app run off localStorage.
      setTasks(readJSON<Task[]>(TASK_STORAGE_KEY, []));
      setDocs(readJSON<MilindDocFile[]>(DOCS_LIBRARY_KEY, []));
      setLinks(readJSON<LinkGraph>(LINKS_STORAGE_KEY, {}));
      setHydrated(true);
      // Allow a retry on the next render cycle.
      hydratedFromDriveRef.current = false;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, session?.error, status]);

  // ── localStorage fallback persistence (dev bypass / no token only) ──
  // When milindDrive is active (tokenRef.current is set), the API calls
  // inside each mutator handle persistence.  These effects are only the
  // safety net for the offline / dev-bypass path.

  useEffect(() => {
    if (!hydrated || tokenRef.current) return;
    writeBatched(TASK_STORAGE_KEY, tasks.filter((t) => t.source !== "asana"));
  }, [tasks, hydrated]);

  useEffect(() => {
    if (!hydrated || tokenRef.current) return;
    writeBatched(DOCS_LIBRARY_KEY, docs);
  }, [docs, hydrated]);

  useEffect(() => {
    if (!hydrated || tokenRef.current) return;
    writeBatched(LINKS_STORAGE_KEY, links);
  }, [links, hydrated]);

  /* A projected row (a doc on the board, a task in the docs list) is edited
   * through whichever mutator that view happens to call. These forward refs
   * let each mutator hand off to the other when the id isn't its own, so a
   * projected row is never a silent no-op. An id lives in exactly one list, so
   * the handoff cannot bounce back. */
  const updateDocRef = useRef<(id: string, patch: Partial<MilindDocFile>) => void>(() => {});
  const deleteDocRef = useRef<(id: string) => void>(() => {});

  // ── Task mutators ──────────────────────────────────────────────

  const addTask = useCallback((task: Task) => {
    setTasks((prev) => [task, ...prev]);
    // A record created with facets never passes through updateRecord.
    writeFacetRescue(task.id, task as unknown as Record<string, unknown>, RESCUED_TASK_FIELDS);
    const token = tokenRef.current;
    if (token && task.source !== "asana") {
      driveCreateTask(token, task).catch(console.error);
    }
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    // Not a task? Then it's a doc showing on the board — translate and hand off.
    if (!tasksRef.current.some((t) => t.id === id)) {
      if (docsRef.current.some((d) => d.id === id)) {
        const docPatch: Partial<MilindDocFile> = { updatedAt: Date.now() };
        if (patch.title !== undefined) docPatch.title = patch.title;
        if (patch.completed !== undefined) docPatch.completed = patch.completed;
        if (patch.importance !== undefined) docPatch.importance = patch.importance;
        if (patch.dueDate !== undefined) docPatch.dueDate = patch.dueDate;
        if (patch.columnId !== undefined) docPatch.columnId = patch.columnId;
        if (patch.body !== undefined) docPatch.content = patch.body;
        if (patch.sheet !== undefined) docPatch.sheet = patch.sheet;
      writeFacetRescue(id, docPatch as Record<string, unknown>, RESCUED_DOC_FIELDS);
        updateDocRef.current(id, docPatch);
      }
      return;
    }

    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const token = tokenRef.current;
    if (token) {
      // Guard: don't write Asana-sourced tasks to milindDrive.
      const task = tasksRef.current.find((t) => t.id === id);
      if (task?.source !== "asana") {
        drivePatchTask(token, id, patch).catch(console.error);
      }
    }
  }, []);

  const deleteTask = useCallback((id: string) => {
    forgetFacetRescue(id);
    if (!tasksRef.current.some((t) => t.id === id)) {
      if (docsRef.current.some((d) => d.id === id)) deleteDocRef.current(id);
      return;
    }
    const task = tasksRef.current.find((t) => t.id === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setLinks((prev) => pruneEntity(prev, entityKey("task", id)));
    const token = tokenRef.current;
    if (token && task?.source !== "asana") {
      driveDeleteTask(token, id).catch(console.error);
    }
  }, []);

  // ── Doc mutators ───────────────────────────────────────────────

  const addDoc = useCallback((doc: MilindDocFile) => {
    setDocs((prev) => [doc, ...prev]);
    const token = tokenRef.current;
    if (token) {
      driveCreateDoc(token, doc).catch(console.error);
    }
  }, []);

  const updateDoc = useCallback((id: string, patch: Partial<MilindDocFile>) => {
    // Not a doc? Then it's a task showing in the docs list — translate back.
    if (!docsRef.current.some((d) => d.id === id)) {
      if (tasksRef.current.some((t) => t.id === id)) {
        const taskPatch: Partial<Task> = {};
        if (patch.title !== undefined) taskPatch.title = patch.title;
        if (patch.content !== undefined) taskPatch.body = patch.content;
        if (patch.sheet !== undefined) taskPatch.sheet = patch.sheet;
        if (patch.completed !== undefined) taskPatch.completed = patch.completed;
        if (patch.importance !== undefined) taskPatch.importance = patch.importance;
        if (patch.dueDate !== undefined) taskPatch.dueDate = patch.dueDate;
        if (patch.columnId !== undefined) taskPatch.columnId = patch.columnId;
        updateTask(id, taskPatch);
      }
      return;
    }

    // React state update is always immediate (optimistic UI).
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );

    const token = tokenRef.current;
    if (!token) return;

    // API write is debounced per-doc to avoid flooding on rapid keystrokes.
    // We accumulate patches so the final flush always has the latest values.
    const timers = docPatchTimers.current;
    const pending = docPendingPatches.current;

    pending.set(id, { ...(pending.get(id) ?? {}), ...patch });

    if (timers.has(id)) clearTimeout(timers.get(id)!);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        const finalPatch = pending.get(id)!;
        pending.delete(id);
        // Re-read tokenRef so we always use the freshest token.
        const latestToken = tokenRef.current;
        if (latestToken) {
          drivePatchDoc(latestToken, id, finalPatch).catch(console.error);
        }
      }, 800),
    );
  }, [updateTask]);

  const deleteDoc = useCallback((id: string) => {
    forgetFacetRescue(id);
    if (!docsRef.current.some((d) => d.id === id)) {
      if (tasksRef.current.some((t) => t.id === id)) deleteTask(id);
      return;
    }

    // Cancel any pending debounced patch for this doc.
    const timers = docPatchTimers.current;
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!);
      timers.delete(id);
      docPendingPatches.current.delete(id);
    }

    setDocs((prev) => prev.filter((d) => d.id !== id));
    setLinks((prev) => pruneEntity(prev, entityKey("doc", id)));

    const token = tokenRef.current;
    if (token) {
      driveDeleteDoc(token, id).catch(console.error);
    }
  }, [deleteTask]);

  useEffect(() => { updateDocRef.current = updateDoc; }, [updateDoc]);
  useEffect(() => { deleteDocRef.current = deleteDoc; }, [deleteDoc]);

  // ── Link mutators ──────────────────────────────────────────────

  const link = useCallback((from: EntityKey, to: EntityKey) => {
    setLinks((prev) => {
      let next = addEdge(prev, from, to);
      next = addEdge(next, to, from); // keep graph symmetric
      return next;
    });
    const token = tokenRef.current;
    if (token) {
      // The server's POST /api/links inserts both directions in one call.
      driveAddLink(token, from, to).catch(console.error);
    }
  }, []);

  const unlink = useCallback((from: EntityKey, to: EntityKey) => {
    setLinks((prev) => {
      let next = removeEdge(prev, from, to);
      next = removeEdge(next, to, from);
      return next;
    });
    const token = tokenRef.current;
    if (token) {
      driveRemoveLink(token, from, to).catch(console.error);
    }
  }, []);

  // ── Label resolver ─────────────────────────────────────────────

  const registerLabelResolver = useCallback(
    (kind: EntityKind, resolver: (id: string) => string | undefined) => {
      resolverRefs.current[kind] = resolver;
      return () => {
        if (resolverRefs.current[kind] === resolver) {
          delete resolverRefs.current[kind];
        }
      };
    },
    [],
  );

  const resolveLabel = useCallback((key: EntityKey): string => {
    const parsed = key.indexOf(":");
    if (parsed === -1) return key;
    const kind = key.slice(0, parsed) as EntityKind;
    const id = key.slice(parsed + 1);
    if (kind === "task") {
      return tasksRef.current.find((t) => t.id === id)?.title || "Untitled task";
    }
    if (kind === "doc") {
      return docsRef.current.find((d) => d.id === id)?.title || "Untitled doc";
    }
    if (kind === "event") {
      const fromResolver = resolverRefs.current.event?.(id);
      if (fromResolver) return fromResolver;
      return "Calendar event";
    }
    return key;
  }, []);

  // ── Open-as-doc ────────────────────────────────────────────────

  const [pendingOpenDocId, setPendingOpenDocId] = useState<string | null>(null);
  const clearPendingOpenDoc = useCallback(() => setPendingOpenDocId(null), []);

  const openAsDoc = useCallback(
    (key: EntityKey, seed?: { title?: string; description?: string }): string | null => {
      const parsed = parseEntityKey(key);
      if (!parsed) return null;

      // If the key is already a doc, just open it.
      if (parsed.kind === "doc") {
        setPendingOpenDocId(parsed.id);
        return parsed.id;
      }

      // Reuse an existing linked doc if one already exists.
      const existingDocKey = neighbors(linksRef.current, key).find((n) =>
        n.startsWith("doc:"),
      );
      if (existingDocKey) {
        const existingId = existingDocKey.slice("doc:".length);
        setPendingOpenDocId(existingId);
        return existingId;
      }

      // Create a new doc seeded from the source entity.
      const title =
        seed?.title?.trim() ||
        (parsed.kind === "task"
          ? tasksRef.current.find((t) => t.id === parsed.id)?.title
          : resolverRefs.current.event?.(parsed.id)) ||
        "Untitled";
      const description =
        seed?.description?.trim() ||
        (parsed.kind === "task"
          ? tasksRef.current.find((t) => t.id === parsed.id)?.description
          : undefined);

      const newDoc: MilindDocFile = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        content: description
          ? {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text: description }] },
              ],
            }
          : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        links: [],
      };

      setDocs((prev) => [newDoc, ...prev]);
      setLinks((prev) => {
        const to = entityKey("doc", newDoc.id);
        let next = addEdge(prev, key, to);
        next = addEdge(next, to, key);
        return next;
      });
      setPendingOpenDocId(newDoc.id);

      // Persist to milindDrive — one create + one link call.
      const token = tokenRef.current;
      if (token) {
        driveCreateDoc(token, newDoc).catch(console.error);
        // POST /api/links inserts both directions for us.
        driveAddLink(token, key, entityKey("doc", newDoc.id)).catch(console.error);
      }

      return newDoc.id;
    },
    [setDocs, setLinks],
  );

  /* ── Facet projections ────────────────────────────────────────────
   *
   * The board shows everything actionable and the docs list shows everything
   * with a body — regardless of which table the row came from. A task that
   * gained body content appears in docs; a doc that gained a completion state
   * appears on the board. Same record, second view.
   *
   * These are what the Tasks/Docs contexts publish. The raw `tasks` / `docs`
   * state stays separate and is what persistence writes, so a projected row is
   * never saved into the wrong table. */

  const tasksProjected = useMemo<Task[]>(() => {
    // Only records that actually carry a task facet. A record stored in the
    // tasks table but created as, say, a sheet has no completion state and
    // does not belong on the board.
    const out = tasks.filter((t) => t.completed !== undefined);
    for (const d of docs) {
      if (d.completed === undefined) continue;
      out.push({
        id: d.id,
        title: d.title || "Untitled",
        completed: d.completed,
        createdAt: d.createdAt,
        importance: d.importance ?? "medium",
        dueDate: d.dueDate,
        columnId: d.columnId,
        body: d.content,
        sheet: d.sheet,
        start: d.calendarMeta?.start,
        end: d.calendarMeta?.end,
        allDay: d.calendarMeta?.allDay,
      });
    }
    return out;
  }, [tasks, docs]);

  const docsProjected = useMemo<MilindDocFile[]>(() => {
    const out = [...docs];
    for (const t of tasks) {
      if (t.body === undefined || t.body === null) continue;
      out.push({
        id: t.id,
        title: t.title,
        content: t.body,
        sheet: t.sheet,
        createdAt: t.createdAt,
        updatedAt: t.createdAt,
        links: [],
        completed: t.completed,
        importance: t.importance,
        dueDate: t.dueDate,
        columnId: t.columnId,
      });
    }
    return out;
  }, [tasks, docs]);

  // ── The one record space ───────────────────────────────────────
  //
  // Tasks and docs are two tables for storage reasons, but the app's domain
  // has a single record type. This projects both into MilindRecord so every
  // view can filter by facet (start -> calendar, status -> board, body ->
  // editor) instead of by which table a row came from.

  const records = useMemo<MilindRecord[]>(() => {
    const out: MilindRecord[] = [];
    for (const t of tasks) out.push(recordFromTask(t));
    for (const d of docs) out.push(recordFromDoc(d));
    return out;
  }, [tasks, docs]);

  /** Apply a record patch to whichever store actually holds the id. */
  const updateRecord = useCallback((id: string, patch: Partial<MilindRecord>): boolean => {
    if (tasksRef.current.some((t) => t.id === id)) {
      const taskPatch: Partial<Task> = {};
      if (patch.title !== undefined) taskPatch.title = patch.title;
      if (patch.summary !== undefined) taskPatch.description = patch.summary;
      if (patch.status !== undefined) taskPatch.completed = patch.status === "done";
      if (patch.importance !== undefined) taskPatch.importance = patch.importance;
      if (patch.dueDate !== undefined) taskPatch.dueDate = patch.dueDate;
      if (patch.columnId !== undefined) taskPatch.columnId = patch.columnId;
      if (patch.start !== undefined) taskPatch.start = patch.start;
      if (patch.end !== undefined) taskPatch.end = patch.end;
      if (patch.allDay !== undefined) taskPatch.allDay = patch.allDay;
      if (patch.body !== undefined) taskPatch.body = patch.body;
      if (patch.canvasPos !== undefined) taskPatch.canvasPos = patch.canvasPos;
      if (patch.sheet !== undefined) taskPatch.sheet = patch.sheet;
      // Mirror everything the server drops so it survives a reload.
      writeFacetRescue(id, taskPatch as Record<string, unknown>, RESCUED_TASK_FIELDS);
      updateTask(id, taskPatch);
      return true;
    }

    if (docsRef.current.some((d) => d.id === id)) {
      const docPatch: Partial<MilindDocFile> = { updatedAt: Date.now() };
      if (patch.title !== undefined) docPatch.title = patch.title;
      if (patch.body !== undefined) docPatch.content = patch.body;
      if (patch.status !== undefined) docPatch.completed = patch.status === "done";
      if (patch.importance !== undefined) docPatch.importance = patch.importance;
      if (patch.dueDate !== undefined) docPatch.dueDate = patch.dueDate;
      if (patch.columnId !== undefined) docPatch.columnId = patch.columnId;
      if (patch.graphPos !== undefined) docPatch.graphPos = patch.graphPos;
      if (patch.nodeColor !== undefined) docPatch.nodeColor = patch.nodeColor;
      if (patch.sheet !== undefined) docPatch.sheet = patch.sheet;
      // A doc that gains a time carries it in calendarMeta, which is also what
      // the Google projection reads.
      if (patch.start !== undefined || patch.end !== undefined) {
        const existing = docsRef.current.find((d) => d.id === id);
        const start = patch.start ?? existing?.calendarMeta?.start;
        const end = patch.end ?? existing?.calendarMeta?.end;
        if (start && end) {
          docPatch.calendarMeta = {
            ...(existing?.calendarMeta ?? {
              eventId: "",
              calendarId: "",
              title: existing?.title ?? "Untitled",
              allDay: false,
            }),
            title: patch.title ?? existing?.title ?? "Untitled",
            start,
            end,
            allDay: patch.allDay ?? existing?.calendarMeta?.allDay ?? false,
          };
        }
      }
      updateDoc(id, docPatch);
      return true;
    }

    return false;
  }, [updateTask, updateDoc]);

  // ── Context value ──────────────────────────────────────────────

  const actionsValue = useMemo<EntityActions>(
    () => ({
      setTasks, addTask, updateTask, deleteTask,
      setDocs, addDoc, updateDoc, deleteDoc,
      setLinks, link, unlink,
      resolveLabel, registerLabelResolver,
      pendingOpenDocId, openAsDoc, clearPendingOpenDoc,
      updateRecord,
      driveAuthError,
    }),
    [
      setTasks, addTask, updateTask, deleteTask,
      setDocs, addDoc, updateDoc, deleteDoc,
      setLinks, link, unlink,
      resolveLabel, registerLabelResolver,
      pendingOpenDocId, openAsDoc, clearPendingOpenDoc,
      updateRecord,
      driveAuthError,
    ],
  );

  return (
    <TasksContext.Provider value={tasksProjected}>
      <DocsContext.Provider value={docsProjected}>
        <LinksContext.Provider value={links}>
          <RecordsContext.Provider value={records}>
            <EntityActionsContext.Provider value={actionsValue}>
              {children}
            </EntityActionsContext.Provider>
          </RecordsContext.Provider>
        </LinksContext.Provider>
      </DocsContext.Provider>
    </TasksContext.Provider>
  );
}

// ── Graph helper ───────────────────────────────────────────────────

/** Remove every edge that touches `key` (called on entity delete). */
function pruneEntity(graph: LinkGraph, key: EntityKey): LinkGraph {
  const next: LinkGraph = {};
  for (const [from, tos] of Object.entries(graph)) {
    if (from === key) continue;
    const filtered = tos.filter((t) => t !== key);
    if (filtered.length > 0) next[from] = filtered;
  }
  return next;
}

// ── Hooks ──────────────────────────────────────────────────────────

export function useTasks(): Task[] {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks must be used inside EntityStoreProvider");
  return ctx;
}

export function useDocs(): MilindDocFile[] {
  const ctx = useContext(DocsContext);
  if (!ctx) throw new Error("useDocs must be used inside EntityStoreProvider");
  return ctx;
}

export function useLinks(): LinkGraph {
  const ctx = useContext(LinksContext);
  if (!ctx) throw new Error("useLinks must be used inside EntityStoreProvider");
  return ctx;
}

/** Every record in the app, projected into the one model. Filter by facet —
 *  `isScheduled`, `isActionable`, `hasBody` — rather than by source table. */
export function useRecords(): MilindRecord[] {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error("useRecords must be used inside EntityStoreProvider");
  return ctx;
}

export function useEntityActions(): EntityActions {
  const ctx = useContext(EntityActionsContext);
  if (!ctx) throw new Error("useEntityActions must be used inside EntityStoreProvider");
  return ctx;
}

export function useEntityActionsOptional(): EntityActions | null {
  return useContext(EntityActionsContext);
}
