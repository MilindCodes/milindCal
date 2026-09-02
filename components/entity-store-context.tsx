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

  /** True when the Google OAuth refresh token has expired/been revoked.
   *  The user must re-authenticate to restore milindDrive sync. */
  driveAuthError: boolean;
}

const TasksContext = createContext<Task[] | null>(null);
const DocsContext = createContext<MilindDocFile[] | null>(null);
const LinksContext = createContext<LinkGraph | null>(null);
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

      setTasks(remoteTasks);
      setDocs(remoteDocs);
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

  // ── Task mutators ──────────────────────────────────────────────

  const addTask = useCallback((task: Task) => {
    setTasks((prev) => [task, ...prev]);
    const token = tokenRef.current;
    if (token && task.source !== "asana") {
      driveCreateTask(token, task).catch(console.error);
    }
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
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
  }, []);

  const deleteDoc = useCallback((id: string) => {
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
  }, []);

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

  // ── Context value ──────────────────────────────────────────────

  const actionsValue = useMemo<EntityActions>(
    () => ({
      setTasks, addTask, updateTask, deleteTask,
      setDocs, addDoc, updateDoc, deleteDoc,
      setLinks, link, unlink,
      resolveLabel, registerLabelResolver,
      pendingOpenDocId, openAsDoc, clearPendingOpenDoc,
      driveAuthError,
    }),
    [
      setTasks, addTask, updateTask, deleteTask,
      setDocs, addDoc, updateDoc, deleteDoc,
      setLinks, link, unlink,
      resolveLabel, registerLabelResolver,
      pendingOpenDocId, openAsDoc, clearPendingOpenDoc,
      driveAuthError,
    ],
  );

  return (
    <TasksContext.Provider value={tasks}>
      <DocsContext.Provider value={docs}>
        <LinksContext.Provider value={links}>
          <EntityActionsContext.Provider value={actionsValue}>
            {children}
          </EntityActionsContext.Provider>
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

export function useEntityActions(): EntityActions {
  const ctx = useContext(EntityActionsContext);
  if (!ctx) throw new Error("useEntityActions must be used inside EntityStoreProvider");
  return ctx;
}

export function useEntityActionsOptional(): EntityActions | null {
  return useContext(EntityActionsContext);
}
