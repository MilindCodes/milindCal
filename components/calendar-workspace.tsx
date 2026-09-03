"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import multiMonthPlugin from "@fullcalendar/multimonth";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DateSelectArg, DatesSetArg, EventChangeArg, EventClickArg, EventContentArg, EventInput, MoreLinkArg } from "@fullcalendar/core";
import { AnimatePresence, animate, motion, useMotionValue, useSpring, useTransform, LayoutGroup } from "framer-motion";
import { AlertCircle, AlertTriangle, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, FileText, Layers, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { AuthActions } from "@/components/auth-actions";
import { BrandMark } from "@/components/brand-mark";
import { EntityStoreProvider, useEntityActions, useTasks } from "@/components/entity-store-context";
import { EventEditor } from "@/components/event-editor";
import { NewCalendarDialog } from "@/components/new-calendar-dialog";
import dynamic from "next/dynamic";
import { CalendarEventTile } from "@/components/calendar-event-tile";
import { TasksSidebar } from "@/components/tasks-sidebar";
import { UniversalDragLayer, useUniversalDroppable, type UniversalDropEvent } from "@/components/universal-drag-layer";
import { entityKey, eventKey, parseEventId, type EntityKey, type UniversalDragPayload } from "@/lib/entity-store";
import type { CalendarEvent, CalendarSummary, GoogleEventPayload, MilindDocFile, PanelNote, Task } from "@/lib/models";

/* ── Lazily-loaded heavy views ──
 *
 * Neither of these is on the first-paint path: the canvas renders only when
 * the user picks the Canvas view, and the docs overlay is mounted on an idle
 * callback after the calendar is interactive. Importing them statically put
 * TipTap (15 packages) and the whole canvas/graph tree into the initial
 * bundle anyway, so the idle-mount deferral bought nothing. `next/dynamic`
 * makes the deferral real — the chunks are fetched when first rendered.
 *
 * ssr:false because both are client-only (they touch window/localStorage on
 * mount) and neither contributes to the server-rendered shell.
 */
const NodeCanvasView = dynamic(
  () => import("@/components/node-canvas-view").then((m) => m.NodeCanvasView),
  { ssr: false },
);

const MilindDocsSection = dynamic(
  () => import("@/components/milind-docs-section").then((m) => m.MilindDocsSection),
  { ssr: false },
);

type CalendarView = "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "multiMonthYear" | "nodeCanvas";

interface CalendarWorkspaceProps {
  userName: string;
}

interface EditorDraftWindow {
  start?: string;
  end?: string;
}

const springTransition = {
  type: "spring",
  stiffness: 240,
  damping: 24
} as const;

// Dive physics (hoisted — stable identity so useSpring doesn't re-init on every render)
const DIVE_SPRING = { stiffness: 480, damping: 42, mass: 0.7 } as const;
const STRETCH_SPRING = { stiffness: 260, damping: 26, mass: 0.9 } as const;

const shellVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.99 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.52,
      ease: [0.2, 0.8, 0.2, 1],
      /* No `when: "beforeChildren"` here on purpose.
       *
       * It gates the children on the parent's animation *completing*, and
       * this shell's transform is also driven by long-lived motion values
       * (the docs "dive" spring and the elastic stretch). Those keep the
       * shell's animation active, the completion callback never fires, and
       * every itemVariants child — the toolbar, the control strip, the
       * calendar frame — stays parked at opacity 0. The app loaded with an
       * invisible header and calendar until some unrelated state change
       * forced a re-render.
       *
       * Staggering alone gives the same cascade without the dependency. */
      staggerChildren: 0.06,
      delayChildren: 0.08
    }
  }
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } }
} as const;

const MONTH_DAY_EVENT_PREVIEW_LIMIT = 5;

// Module-level cache: most calendars share a small set of colors so repeated
// calls for the same hex are O(1) after the first computation.
const textColorCache = new Map<string, string>();

function getTextColorForBg(hex: string): string {
  if (!hex || typeof hex !== "string") return "#f0f4ff";
  const cached = textColorCache.get(hex);
  if (cached) return cached;
  const clean = hex.replace("#", "");
  if (clean.length < 6) return "#f0f4ff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Relative luminance (WCAG formula)
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  const result = L > 0.35 ? "#1a1a2e" : "#f0f4ff";
  textColorCache.set(hex, result);
  return result;
}

/** Etag-less fallback comparison. Only covers the fields that reach the
 *  rendered tile or the editor's initial state — anything else changing
 *  without an etag change wouldn't be visible until the next full reload
 *  anyway. */
function isRenderedEventChanged(a: CalendarEvent, b: CalendarEvent): boolean {
  return (
    a.title !== b.title ||
    a.start !== b.start ||
    a.end !== b.end ||
    a.allDay !== b.allDay ||
    a.color !== b.color ||
    a.location !== b.location ||
    a.description !== b.description ||
    a.attendees.length !== b.attendees.length
  );
}

/** Tile colours for scheduled tasks. Mirrors the task board's importance
 *  colours so the same record reads as the same thing in both views. */
const IMPORTANCE_EVENT_COLORS: Record<string, string> = {
  low: "#6b7280",
  medium: "#f59e0b",
  high: "#ef4444",
};

const VIEW_LABELS: Record<CalendarView, string> = {
  timeGridDay: "Day",
  timeGridWeek: "Week",
  dayGridMonth: "Month",
  multiMonthYear: "Year",
  nodeCanvas: "Canvas"
};

const VIEW_OPTIONS = [
  { label: "Day", value: "timeGridDay" },
  { label: "Week", value: "timeGridWeek" },
  { label: "Month", value: "dayGridMonth" },
  { label: "Year", value: "multiMonthYear" },
  { label: "Canvas", value: "nodeCanvas" }
] as const;

// How far beyond the visible range to pre-fetch on each load.
const PREFETCH_BEFORE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks back
const PREFETCH_AFTER_MS  = 42 * 24 * 60 * 60 * 1000; // 6 weeks forward
// Consider cached data stale after 3 minutes.
const CACHE_TTL_MS = 3 * 60 * 1000;

export function CalendarWorkspace(props: CalendarWorkspaceProps) {
  return (
    <EntityStoreProvider>
      <CalendarWorkspaceInner {...props} />
    </EntityStoreProvider>
  );
}

function CalendarWorkspaceInner({ userName }: CalendarWorkspaceProps) {
  const tasks = useTasks();
  const { addTask, addDoc, updateTask, updateRecord, link, registerLabelResolver, pendingOpenDocId, driveAuthError } = useEntityActions();
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarFrameRef = useRef<HTMLDivElement | null>(null);
  const syncVersionRef = useRef(0);
  const readEventsAbortRef = useRef<AbortController | null>(null);
  const readCalendarsAbortRef = useRef<AbortController | null>(null);
  // Event cache keyed by "calendarId::eventId" — accumulates across navigations
  // so switching between weeks is instant once the data has been pre-fetched.
  const eventsCacheRef = useRef<Map<string, CalendarEvent>>(new Map());
  // Tracks the date window that is already in the cache [epoch ms start, end].
  const fetchedWindowRef = useRef<{ start: number; end: number; at: number } | null>(null);
  // Set after the first version poll so we don't double-fetch on mount.
  const initialVersionSetRef = useRef(false);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<CalendarView>("timeGridWeek");
  // Initialize to the current week so the first readEvents fetch matches
  // what FullCalendar renders, avoiding a redundant double-fetch on mount.
  const [range, setRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return { start: weekStart.toISOString(), end: weekEnd.toISOString() };
  });
  const [calendarTitle, setCalendarTitle] = useState("");
  const [navDirection, setNavDirection] = useState<"prev" | "next" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventEditorOpen, setEventEditorOpen] = useState(false);

  // Clear the FullCalendar drag-selection highlight when the editor is dismissed
  useEffect(() => {
    if (!eventEditorOpen) {
      calendarRef.current?.getApi()?.unselect();
    }
  }, [eventEditorOpen]);
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [draftWindow, setDraftWindow] = useState<EditorDraftWindow>({});
  const [liveSyncMode, setLiveSyncMode] = useState<"connecting" | "live" | "fallback">("connecting");
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedDateEvents, setExpandedDateEvents] = useState<CalendarEvent[]>([]);
  const [expandedAnchorRect, setExpandedAnchorRect] = useState<DOMRect | null>(null);

  const calendarHeight = view === "multiMonthYear" ? "auto" : "100%";
  const isCanvasView = view === "nodeCanvas";

  /* ── milindDocs elastic scroll ── */
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [docsVisible, setDocsVisible] = useState(false);
  const [hasMountedDocs, setHasMountedDocs] = useState(false);

  useEffect(() => {
    // Pre-warm docs editor off-screen on next idle frame
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      requestIdleCallback(() => setHasMountedDocs(true));
    } else {
      setTimeout(() => setHasMountedDocs(true), 2000);
    }
  }, []);

  /* When the store flags a doc to open (via openAsDoc from any view) and the
   * docs panel is closed, raise it so MilindDocsSection can consume the id. */
  useEffect(() => {
    if (pendingOpenDocId && !docsVisible) openDocs();
  // openDocs is intentionally omitted — it depends on docsVisible and is stable enough
  // for this single-shot raise-on-pending behavior.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenDocId, docsVisible]);
  const [docsExitMode, setDocsExitMode] = useState<"normal" | "to-calendar">("normal");
  const [editorEntranceFrom, setEditorEntranceFrom] = useState<"side" | "doc">("side");
  const docPendingTitleRef = useRef<string>("");
  const docPendingDescriptionRef = useRef<string>("");
  // Populated when a task is dragged from the sidebar and dropped onto the calendar
  const taskDropTitleRef = useRef<string>("");
  const taskDropDescriptionRef = useRef<string>("");
  const wheelAccRef = useRef(0);
  const stretchResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDocsAnimatingRef = useRef(false);
  const SNAP_THRESHOLD = 180;
  const MAX_STRETCH = 44;

  // ── Single unified "dive" progress. 0 = calendar, 1 = docs. ──
  // We animate the motion value directly with `animate()` rather than
  // chaining through useSpring, which in framer-motion 11 can drop updates
  // when its internal effect re-runs.
  const dive = useMotionValue(0);
  const diveAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const driveDive = useCallback((to: number) => {
    diveAnimRef.current?.stop();
    diveAnimRef.current = animate(dive, to, {
      type: "spring",
      stiffness: DIVE_SPRING.stiffness,
      damping: DIVE_SPRING.damping,
      mass: DIVE_SPRING.mass,
    });
  }, [dive]);

  // Small pre-snap elastic offsets — one per side. Pure transform, no filters.
  const calStretch = useMotionValue(0);
  const calStretchAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const driveCalStretch = useCallback((to: number) => {
    calStretchAnimRef.current?.stop();
    calStretchAnimRef.current = animate(calStretch, to, {
      type: "spring",
      stiffness: STRETCH_SPRING.stiffness,
      damping: STRETCH_SPRING.damping,
      mass: STRETCH_SPRING.mass,
    });
  }, [calStretch]);

  const docsStretch = useMotionValue(0);
  const docsStretchAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const driveDocsStretch = useCallback((to: number) => {
    docsStretchAnimRef.current?.stop();
    docsStretchAnimRef.current = animate(docsStretch, to, {
      type: "spring",
      stiffness: STRETCH_SPRING.stiffness,
      damping: STRETCH_SPRING.damping,
      mass: STRETCH_SPRING.mass,
    });
  }, [docsStretch]);

  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  // Docs transforms — Y = (1 - dive) * windowHeight + docsStretch
  const docsY = useTransform<number, number>([dive, docsStretch], ([d, s]) => (1 - Number(d)) * windowHeight + Number(s));
  const docsScale = useTransform(dive, [0, 1], [0.98, 1]);
  const docsOpacity = useTransform(dive, [0, 0.08, 1], [0, 1, 1]);

  // Calendar transforms — scale/opacity retreat as dive grows; tiny anticipation on cal-side stretch.
  const calendarScale = useTransform<number, number>([dive, calStretch], ([d, s]) => {
    const retreat = 1 - Number(d) * 0.035;
    const anticipation = 1 + Number(s) * 0.0003;
    return retreat * anticipation;
  });
  const calendarY = useTransform(calStretch, [-MAX_STRETCH, 0], [-4, 0]);
  const calendarOpacity = useTransform(dive, [0, 1], [1, 0.5]);

  // Orb ambient (keep subtle parallax on open)
  const orbBlur = useTransform(dive, [0, 1], ["0px", "20px"]);
  const orbOpacity = useTransform(dive, [0, 1], [0.8, 0.1]);

  const clearStretchTimer = () => {
    if (stretchResetTimerRef.current) {
      clearTimeout(stretchResetTimerRef.current);
      stretchResetTimerRef.current = null;
    }
  };

  const openDocs = useCallback(() => {
    if (isDocsAnimatingRef.current || docsVisible) return;
    clearStretchTimer();
    wheelAccRef.current = 0;
    driveCalStretch(0);
    driveDocsStretch(0);
    isDocsAnimatingRef.current = true;
    setDocsVisible(true);
    driveDive(1);
    setTimeout(() => { isDocsAnimatingRef.current = false; }, 380);
  }, [driveCalStretch, driveDive, driveDocsStretch, docsVisible]);

  const closeDocs = useCallback(() => {
    if (isDocsAnimatingRef.current || !docsVisible) return;
    clearStretchTimer();
    wheelAccRef.current = 0;
    driveCalStretch(0);
    driveDocsStretch(0);
    isDocsAnimatingRef.current = true;
    setDocsVisible(false);
    driveDive(0);
    setTimeout(() => { isDocsAnimatingRef.current = false; }, 380);
  }, [driveCalStretch, driveDive, driveDocsStretch, docsVisible]);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (isDocsAnimatingRef.current) return;

      const target = e.target as HTMLElement;

      if (!docsVisible) {
        // ── CAL → DOCS: scroll-down past calendar ──
        if (target.closest(".fc-scroller") || target.closest(".fc-timegrid-body")) return;
        if (e.deltaY > 0) {
          e.preventDefault();
          wheelAccRef.current = Math.min(wheelAccRef.current + e.deltaY * 0.55, SNAP_THRESHOLD * 1.25);
          const p = Math.min(wheelAccRef.current / SNAP_THRESHOLD, 1);
          driveCalStretch(-p * MAX_STRETCH);

          clearStretchTimer();
          stretchResetTimerRef.current = setTimeout(() => {
            wheelAccRef.current = 0;
            driveCalStretch(0);
          }, 240);

          if (wheelAccRef.current >= SNAP_THRESHOLD) openDocs();
        } else {
          wheelAccRef.current = 0;
          driveCalStretch(0);
        }
      } else {
        // ── DOCS → CAL: scroll-up past top of editor column ──
        const editorCol = target.closest(".docs-editor-col") as HTMLElement | null;
        if (!editorCol) return;
        if (editorCol.scrollTop > 0) return;

        if (e.deltaY < 0) {
          e.preventDefault();
          wheelAccRef.current = Math.min(wheelAccRef.current + Math.abs(e.deltaY) * 0.55, SNAP_THRESHOLD * 1.25);
          const p = Math.min(wheelAccRef.current / SNAP_THRESHOLD, 1);
          driveDocsStretch(p * MAX_STRETCH);

          clearStretchTimer();
          stretchResetTimerRef.current = setTimeout(() => {
            wheelAccRef.current = 0;
            driveDocsStretch(0);
          }, 240);

          if (wheelAccRef.current >= SNAP_THRESHOLD) closeDocs();
        } else {
          wheelAccRef.current = 0;
          driveDocsStretch(0);
        }
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsVisible, openDocs, closeDocs]);

  useEffect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if (e.key === "d" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (docsVisible) closeDocs(); else openDocs();
      } else if (e.key === "Escape" && docsVisible) {
        e.preventDefault();
        closeDocs();
      }
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, [docsVisible, openDocs, closeDocs]);

  /* FC's external Draggable was removed when we unified on dnd-kit — tasks
   * and docs now drop onto the calendar via the universal drag layer. The
   * calendar wrapper registers itself as a dnd-kit droppable below. */

  const handleDocAddToCalendar = useCallback((title: string, description: string) => {
    docPendingTitleRef.current = title;
    docPendingDescriptionRef.current = description;
    setDocsExitMode("to-calendar");
    setEditorEntranceFrom("doc");
    closeDocs();
    setEditingEvent(null);
    setDraftWindow({
      start: new Date().toISOString(),
      end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    // Open editor after the docs exit spring settles (~260ms for stiffness:420 damping:32)
    setTimeout(() => {
      setEventEditorOpen(true);
      setDocsExitMode("normal");
    }, 260);
  }, [closeDocs]);

  const handleDocAddToTodo = useCallback((_title: string) => {
    // Task creation happens inside MilindDoc itself; this is just for side effects.
  }, []);

  const handleSendNoteToCanvas = useCallback((_note: PanelNote) => {
    closeDocs();
    // Give docs overlay time to exit, then switch to canvas.
    // nodeCanvas is a local-only view so setView is all that's needed.
    setTimeout(() => setView("nodeCanvas"), 420);
  }, [closeDocs]);

  const handleSyncEventDescription = useCallback(async (
    eventId: string,
    calendarId: string,
    description: string,
    eventPayload: { title: string; start: string; end: string; location: string; allDay: boolean }
  ) => {
    try {
      await fetch(`/api/google/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarId,
          event: {
            title: eventPayload.title,
            description,
            location: eventPayload.location,
            start: eventPayload.start,
            end: eventPayload.end,
            allDay: eventPayload.allDay,
            attendees: [],
            recurrence: [],
            reminders: { useDefault: true, overrides: [] },
            eventType: "meeting",
            colorId: "9",
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      });
    } catch { /* ignore sync errors silently */ }
  }, []);

  const [pendingCalendarDoc, setPendingCalendarDoc] = useState<MilindDocFile | null>(null);

  const handleConvertToDoc = useCallback((event: CalendarEvent) => {
    const doc: MilindDocFile = {
      id: Math.random().toString(36).slice(2, 10),
      title: event.title,
      content: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      links: [],
      calendarMeta: {
        eventId: event.id,
        calendarId: event.calendarId,
        title: event.title,
        start: event.start,
        end: event.end,
        description: event.description,
        location: event.location,
        allDay: event.allDay,
      },
    };
    setPendingCalendarDoc(doc);
    setEventEditorOpen(false);
    openDocs();
  }, [openDocs]);

  /* ── Calendar event label resolver ──
   *
   * Events live outside the EntityStore (Google owns them). Publish a
   * resolver so the store can render event titles in backlink chips.
   */
  useEffect(() => {
    const resolver = (id: string): string | undefined => {
      const parsed = parseEventId(id);
      if (!parsed) return undefined;
      return events.find((e) => e.id === parsed.eventId && e.calendarId === parsed.calendarId)?.title;
    };
    return registerLabelResolver("event", resolver);
  }, [events, registerLabelResolver]);

  /* ── Universal drop router ──
   *
   * Every cross-container drag in the app funnels through here. The source
   * payload and target-zone metadata together decide what to do: create a
   * new entity of the target kind, link the two, and open the right editor.
   *
   * Same-kind drops (e.g. task → task column) are handled inside the
   * individual sidebars so they can do sort-specific work. We ignore them.
   *
   * `events` is read through a ref so handleUniversalDrop stays referentially
   * stable across polling-driven re-renders. A changing handler was churning
   * the DndContext's onDragEnd prop, which can lose in-flight drops.
   */
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; });

  /* Same reasoning for tasks: tile renderers and drop handlers need the
   * current list without being re-created on every task edit. */
  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => { tasksRef.current = tasks; });

  const handleUniversalDrop = useCallback(
    (evt: UniversalDropEvent) => {
      const { source, target } = evt;
      const sourceKey: EntityKey = source.kind === "event" && source.calendarId
        ? eventKey(source.calendarId, source.id)
        : entityKey(source.kind, source.id);

      // Same-kind drops are reorder/move intents handled by the sidebar itself.
      if (source.kind === target.targetKind) return;

      /* ── task → calendar ─────────────────────
       *
       * This does NOT create an event. The task *becomes* scheduled: we write
       * start/end onto the existing record and it starts rendering on the grid
       * as well as the board — one record, two views.
       *
       * The old behaviour opened the event editor, created a second entity in
       * Google, and joined the two with a link edge. From that moment the copies
       * drifted: renaming the event left the task's title stale, completing the
       * task left the event behind. */
      if (source.kind === "task" && target.targetKind === "event") {
        const slotStart = typeof target.data?.start === "string"
          ? target.data.start as string
          : new Date().toISOString();
        const slotEnd = typeof target.data?.end === "string"
          ? target.data.end as string
          : new Date(new Date(slotStart).getTime() + 60 * 60 * 1000).toISOString();
        const allDay = target.data?.allDay === true;

        updateTask(source.id, { start: slotStart, end: slotEnd, allDay });
        return;
      }

      /* ── doc → event ────────────────────────── */
      if (source.kind === "doc" && target.targetKind === "event") {
        docPendingTitleRef.current = source.label || "Untitled";
        docPendingDescriptionRef.current = source.description ?? "";
        setEditingEvent(null);
        const slotStart = typeof target.data?.start === "string"
          ? target.data.start as string
          : new Date().toISOString();
        const slotEnd = typeof target.data?.end === "string"
          ? target.data.end as string
          : new Date(new Date(slotStart).getTime() + 60 * 60 * 1000).toISOString();
        setDraftWindow({ start: slotStart, end: slotEnd });
        setEditorEntranceFrom("doc");
        setEventEditorOpen(true);
        pendingLinkSourceRef.current = sourceKey;
        return;
      }

      /* ── event → task ─────────────────────────
       * The one direction that must still create. A Google event is a
       * projection owned by Google, not a milindCal record, so pulling it onto
       * the board materialises the record for the first time and links it back
       * to its Google origin. Once records own their Google projection
       * outright (see lib/record.ts), this collapses too. */
      if (source.kind === "event" && target.targetKind === "task") {
        const ev = source.calendarId
          ? eventsRef.current.find((e) => e.id === source.id && e.calendarId === source.calendarId)
          : undefined;
        const newTask: Task = {
          id: Math.random().toString(36).slice(2, 10),
          title: source.label || ev?.title || "Untitled",
          description: source.description ?? ev?.description ?? "",
          completed: false,
          createdAt: Date.now(),
          importance: "medium",
          columnId: typeof target.data?.columnId === "string" ? target.data.columnId as string : undefined,
          dueDate: ev?.start ? ev.start.slice(0, 10) : undefined,
        };
        addTask(newTask);
        link(sourceKey, entityKey("task", newTask.id));
        return;
      }

      /* ── doc → task ───────────────────────────
       * The doc gains a completion state and starts appearing on the board.
       * Same record — no minted task, no link edge to keep in step. */
      if (source.kind === "doc" && target.targetKind === "task") {
        updateRecord(source.id, {
          status: "open",
          importance: "medium",
          columnId: typeof target.data?.columnId === "string"
            ? target.data.columnId as string
            : undefined,
        });
        return;
      }

      /* ── event → doc ────────────────────────── */
      if (source.kind === "event" && target.targetKind === "doc") {
        const ev = source.calendarId
          ? eventsRef.current.find((e) => e.id === source.id && e.calendarId === source.calendarId)
          : undefined;
        if (!ev) return;
        handleConvertToDoc(ev);
        // handleConvertToDoc already sets pendingCalendarDoc; the resulting
        // doc will have calendarMeta pointing back at this event, giving us
        // a two-way association without an extra link edge.
        return;
      }

      /* ── task → doc ───────────────────────────
       * The task gains body content and starts opening in the editor,
       * seeded from its description. Same record. */
      if (source.kind === "task" && target.targetKind === "doc") {
        const text = source.description?.trim();
        updateRecord(source.id, {
          body: text
            ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
            : { type: "doc", content: [] },
        });
        openDocs();
        return;
      }
    },
    // All mutable entity state is accessed via refs (eventsRef) or stable
    // callbacks (addDoc, addTask, link, handleConvertToDoc). This keeps
    // handleUniversalDrop referentially stable across polling re-renders so
    // DndContext's onDragEnd handler doesn't churn mid-drag.
    [addDoc, addTask, updateTask, updateRecord, handleConvertToDoc, link, openDocs],
  );

  /** Set by handleUniversalDrop when a task/doc is dropped onto the calendar
   *  grid, then consumed inside the createEvent flow to add a link edge from
   *  the source entity to the newly-created event. */
  const pendingLinkSourceRef = useRef<EntityKey | null>(null);

  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [taskBoardExpanded, setTaskBoardExpanded] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);

  const readCalendars = useCallback(async () => {
    readCalendarsAbortRef.current?.abort();
    const controller = new AbortController();
    readCalendarsAbortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/google/calendars", { signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to load calendars");
      }

      const data = (await response.json()) as { calendars: CalendarSummary[] };
      setCalendars(data.calendars);
      setSelectedCalendarIds((previous) =>
        previous.length ? previous : data.calendars.map((calendar) => calendar.id)
      );
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  const readEvents = useCallback(async (options?: { silent?: boolean; force?: boolean }) => {
    readEventsAbortRef.current?.abort();
    const controller = new AbortController();
    readEventsAbortRef.current = controller;

    if (!selectedCalendarIds.length) {
      setEvents([]);
      return;
    }

    const visStartMs = new Date(range.start).getTime();
    const visEndMs   = new Date(range.end).getTime();
    const now        = Date.now();

    // ── Cache hit ──────────────────────────────────────────────────────────
    // Skip the network round-trip when the visible range is fully covered by
    // a recent fetch. This makes navigating pre-fetched weeks instant.
    if (!options?.force) {
      const win = fetchedWindowRef.current;
      if (win && win.start <= visStartMs && win.end >= visEndMs && now - win.at < CACHE_TTL_MS) {
        return;
      }
    }

    // ── Expanded fetch range ───────────────────────────────────────────────
    // Fetch more than what's visible so adjacent weeks are ready immediately.
    const fetchStart = new Date(visStartMs - PREFETCH_BEFORE_MS);
    const fetchEnd   = new Date(visEndMs   + PREFETCH_AFTER_MS);

    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const query = new URLSearchParams({
        calendarIds: selectedCalendarIds.join(","),
        timeMin: fetchStart.toISOString(),
        timeMax: fetchEnd.toISOString()
      });

      const response = await fetch(`/api/google/events?${query.toString()}`, { signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to load events");
      }

      const data = (await response.json()) as { events: CalendarEvent[]; failedCalendarIds?: string[] };

      // ── Merge into cache ───────────────────────────────────────────────
      // Evict any stale entries in the fetched window, then insert fresh ones.
      // Events outside the window are untouched, so the cache only grows.
      const fs = fetchStart.getTime();
      const fe = fetchEnd.getTime();
      let changed = false;
      const newKeys = new Set(data.events.map(ev => `${ev.calendarId}::${ev.id}`));

      // Identify deletions
      for (const [key, ev] of eventsCacheRef.current) {
        const evMs = new Date(ev.start).getTime();
        if (evMs >= fs && evMs < fe) {
          if (!newKeys.has(key)) {
            eventsCacheRef.current.delete(key);
            changed = true;
          }
        }
      }

      // Identify insertions and updates. Prefer Google's per-event etag for an
      // O(1) change check; fall back to comparing the fields the calendar
      // actually renders when either side lacks an etag (shouldn't normally
      // happen). The previous fallback stringified both objects, which on a
      // busy month meant thousands of allocations per poll for a comparison
      // that only a handful of fields can affect.
      for (const ev of data.events) {
        const key = `${ev.calendarId}::${ev.id}`;
        const existing = eventsCacheRef.current.get(key);
        const isChanged = !existing
          || (existing.etag && ev.etag
                ? existing.etag !== ev.etag
                : isRenderedEventChanged(existing, ev));
        if (isChanged) {
          eventsCacheRef.current.set(key, ev);
          changed = true;
        }
      }

      // Expand the known-good window to include what was just fetched.
      const prev = fetchedWindowRef.current;
      fetchedWindowRef.current = {
        start: Math.min(fs, prev?.start ?? fs),
        end:   Math.max(fe, prev?.end   ?? fe),
        at:    now
      };

      if (changed || eventsCacheRef.current.size !== events.length) {
        setEvents(Array.from(eventsCacheRef.current.values()));
      }

      if ((data.failedCalendarIds ?? []).length) {
        setSyncWarning(`Some calendars failed to sync: ${data.failedCalendarIds?.join(", ")}`);
      } else {
        setSyncWarning(null);
      }
    } catch (loadError) {
      if ((loadError as Error).name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load events");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [range.end, range.start, selectedCalendarIds]);

  useEffect(() => {
    void readCalendars();
  }, [readCalendars]);

  useEffect(() => {
    void readEvents();
  }, [readEvents]);

  // Stable ref so the polling effect can call the latest readEvents
  // without including it as a dependency (which would reset the timer on every event reload).
  const readEventsRef = useRef(readEvents);
  useEffect(() => { readEventsRef.current = readEvents; });

  const selectedForSync = useMemo(
    () => Array.from(new Set(selectedCalendarIds.map((item) => item.trim()).filter(Boolean))).sort(),
    [selectedCalendarIds]
  );

  const watchKey = selectedForSync.join(",");

  // Clear the event cache whenever the selected calendar set changes so events
  // from deselected calendars don't linger in the view.
  useEffect(() => {
    eventsCacheRef.current.clear();
    fetchedWindowRef.current = null;
  }, [watchKey]);

  useEffect(() => {
    let active = true;

    const startWatch = async () => {
      if (!selectedForSync.length) {
        setLiveSyncMode("fallback");
        await fetch("/api/google/watch/stop", { method: "POST" }).catch(() => undefined);
        return;
      }

      try {
        const response = await fetch("/api/google/watch/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            calendarIds: selectedForSync
          })
        });

        if (!active) return;

        if (response.ok) {
          const data = (await response.json()) as { channels?: unknown[]; failedCalendarIds?: string[] };
          const hasChannels = Array.isArray(data.channels) && data.channels.length > 0;
          setLiveSyncMode(hasChannels ? "live" : "fallback");
          if ((data.failedCalendarIds ?? []).length) {
            setSyncWarning((existing) =>
              existing ?? `Push watch failed for: ${data.failedCalendarIds?.join(", ")}`
            );
          }
          return;
        }
      } catch {
        // Fallback is handled below.
      }

      if (active) {
        setLiveSyncMode("fallback");
      }
    };

    void startWatch();

    // Renewal only matters for a tab that's still being looked at; a hidden
    // tab re-registers on its next visible tick instead. Google channels last
    // well beyond this interval, so skipping a hidden renewal is safe.
    const renewTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void startWatch();
    }, 25 * 60 * 1000);

    const onVisibleRenew = () => {
      if (document.visibilityState === "visible") void startWatch();
    };
    document.addEventListener("visibilitychange", onVisibleRenew);

    return () => {
      active = false;
      window.clearInterval(renewTimer);
      document.removeEventListener("visibilitychange", onVisibleRenew);
    };
  }, [watchKey, selectedForSync]);

  useEffect(() => {
    const pollVersion = async () => {
      if (isDocsAnimatingRef.current) return;
      try {
        const response = await fetch("/api/google/watch/version", {
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { version?: number };
        if (typeof data.version !== "number") {
          return;
        }

        if (!initialVersionSetRef.current) {
          // First poll: record the baseline so we don't immediately re-fetch
          // data we already loaded on mount.
          syncVersionRef.current = data.version;
          initialVersionSetRef.current = true;
        } else if (data.version > syncVersionRef.current) {
          syncVersionRef.current = data.version;
          await readEventsRef.current({ silent: true, force: true });
        }
      } catch {
        // Keep silent when poll fails. Manual and timed refresh still work.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void pollVersion();
      }
    };

    // Only poll while the tab is actually visible. A backgrounded tab has
    // nothing to repaint, and each tick costs a JWT decrypt plus a KV read on
    // the server. `onVisible` fires an immediate catch-up poll the moment the
    // tab comes back, so nothing is missed by staying quiet in between.
    if (document.visibilityState === "visible") void pollVersion();

    const intervalMs = liveSyncMode === "live" ? 15_000 : 60_000;
    const versionTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void pollVersion();
    }, intervalMs);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(versionTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [liveSyncMode]);

  /* The calendar's source is every record that has a start time — Google
   * events *and* scheduled tasks. A task with a start isn't converted into an
   * event and doesn't get a linked copy; it is the same record, rendered here
   * as well as on the board. Give a scheduled task the "task:" id prefix so
   * click and drag handlers can route back to the record they came from. */
  const fullCalendarEvents = useMemo<EventInput[]>(() => {
    const out: EventInput[] = events.map((event) => ({
      id: `${event.calendarId}::${event.id}`,
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      backgroundColor: event.color,
      borderColor: event.color,
      textColor: event.color ? getTextColorForBg(event.color) : "#f0f4ff"
    }));

    for (const task of tasks) {
      if (!task.start) continue;
      const color = task.completed
        ? "#9ca3af"
        : IMPORTANCE_EVENT_COLORS[task.importance] ?? IMPORTANCE_EVENT_COLORS.medium;
      out.push({
        id: `task:${task.id}`,
        title: task.title,
        start: task.start,
        end: task.end,
        allDay: task.allDay ?? false,
        backgroundColor: color,
        borderColor: color,
        textColor: getTextColorForBg(color),
        classNames: task.completed ? ["fc-record-done"] : undefined,
      });
    }

    return out;
  }, [events, tasks]);

  const changeView = useCallback((nextView: CalendarView) => {
    setView(nextView);
    if (nextView !== "nodeCanvas") {
      calendarRef.current?.getApi().changeView(nextView);
    }
  }, []);

  const onDatesSet = useCallback((args: DatesSetArg) => {
    setRange({
      start: args.start.toISOString(),
      end: args.end.toISOString()
    });
    setCalendarTitle(args.view.title);
  }, []);

  const navigateCalendar = useCallback((action: "prev" | "next" | "today") => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (action === "prev") {
      setNavDirection("prev");
      api.prev();
    } else if (action === "next") {
      setNavDirection("next");
      api.next();
    } else {
      setNavDirection(null);
      api.today();
    }
    // Clear direction after animation
    setTimeout(() => setNavDirection(null), 400);
  }, []);

  const onSelectRange = useCallback((selection: DateSelectArg) => {
    setEditingEvent(null);
    setDraftWindow({
      start: selection.startStr,
      end: selection.endStr
    });
    setEventEditorOpen(true);
  }, []);

  const openNewEvent = useCallback(() => {
    setEditingEvent(null);
    setDraftWindow({
      start: new Date().toISOString(),
      end: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    setEventEditorOpen(true);
  }, []);

  const onEventClick = (eventClick: EventClickArg) => {
    // Scheduled tasks live on the board, so surface them there rather than in
    // the Google event editor, which has no record to load.
    if (eventClick.event.id.startsWith("task:")) {
      setTaskBoardExpanded(true);
      return;
    }

    const sep = eventClick.event.id.indexOf("::");
    if (sep === -1) return;
    const calendarId = eventClick.event.id.slice(0, sep);
    const eventId = eventClick.event.id.slice(sep + 2);
    const found = events.find((event) => event.id === eventId && event.calendarId === calendarId);
    if (!found) return;

    // Open editor immediately with cached data
    setEditingEvent(found);
    setDraftWindow({});
    setEventEditorOpen(true);

    // Fresh-fetch to get up-to-date event data and replace stale cache
    void fetch(`/api/google/events/${eventId}?calendarId=${encodeURIComponent(calendarId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { event: CalendarEvent } | null) => {
        if (data?.event) setEditingEvent(data.event);
      })
      .catch(() => undefined);
  };

  const closeExpandedDay = useCallback(() => {
    setExpandedDate(null);
    setExpandedDateEvents([]);
    setExpandedAnchorRect(null);
  }, []);

  const onMoreLinkClick = useCallback((info: MoreLinkArg) => {
    const dateStr = (info.date as Date).toISOString().split("T")[0];

    if (expandedDate === dateStr) {
      closeExpandedDay();
      return "none" as const;
    }

    const target = info.jsEvent?.target as HTMLElement | null;
    const dayEl = target?.closest(".fc-daygrid-day");
    if (dayEl) {
      setExpandedAnchorRect(dayEl.getBoundingClientRect());
    }

    const seen = new Set<string>();
    const dayEvents = (info.allSegs as Array<{ event: { id: string } }>)
      .map((seg) => {
        const id = seg.event.id as string;
        const sep = id.indexOf("::");
        if (sep === -1) return null;
        const calId = id.slice(0, sep);
        const evId = id.slice(sep + 2);
        return events.find((e) => e.id === evId && e.calendarId === calId) ?? null;
      })
      .filter((e): e is CalendarEvent => {
        if (!e) return false;
        const key = `${e.calendarId}::${e.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    setExpandedDate(dateStr);
    setExpandedDateEvents(dayEvents);
    return "none";
  }, [expandedDate, events, closeExpandedDay]);

  const moreLinkContent = useCallback((info: { num: number }) => {
    return `${info.num}+ more`;
  }, []);

  /* Calendar is a drop target for tasks / docs. The drop router picks the
   * time slot from target.data; we leave it undefined here so it defaults
   * to "now → now + 1h" and the editor opens for fine-tuning. */
  const calendarDroppable = useUniversalDroppable({
    id: "calendar",
    targetKind: "event",
  });

  /** Stable ref-setter for the calendar frame — forwards to both our local
   *  ref (used by the shy-cursor effect) and dnd-kit's droppable registration.
   *  An inline callback here would cause React to run it with (null, node) on
   *  every render, which would thrash dnd-kit's droppable registry. */
  const setCalendarFrameNode = useCallback(
    (node: HTMLDivElement | null) => {
      calendarFrameRef.current = node;
      calendarDroppable.setNodeRef(node);
    },
    [calendarDroppable],
  );

  /* Render each calendar event with our own tile (title + time + drag handle).
   * FC keeps its tile chrome; we replace the inner body so the drag-handle
   * becomes a dnd-kit draggable for cross-view drops. */
  const eventsById = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const ev of events) map.set(`${ev.calendarId}::${ev.id}`, ev);
    return map;
  }, [events]);

  const renderEventContent = useCallback((arg: EventContentArg) => {
    // Scheduled tasks render with a completion checkbox instead of a drag
    // handle — same record as the board row, so it carries the same affordance.
    if (arg.event.id.startsWith("task:")) {
      const taskId = arg.event.id.slice("task:".length);
      const task = tasksRef.current.find((t) => t.id === taskId);
      return (
        <div className="fc-event-tile-inner fc-event-tile-inner--task">
          <button
            aria-label={task?.completed ? "Mark task as open" : "Mark task as done"}
            aria-pressed={task?.completed ?? false}
            className="fc-task-check"
            onClick={(e) => {
              e.stopPropagation();
              updateTask(taskId, { completed: !task?.completed });
            }}
            type="button"
          >
            {task?.completed ? <Check size={11} /> : <Circle size={11} />}
          </button>
          <span className="fc-event-tile-title">{arg.event.title}</span>
        </div>
      );
    }

    const ev = eventsById.get(arg.event.id);
    if (!ev) {
      // Fall back to default text when we can't resolve (e.g. external drop preview)
      return <div className="fc-event-tile-inner"><span className="fc-event-tile-title">{arg.event.title}</span></div>;
    }
    return (
      <CalendarEventTile
        event={ev}
        timeText={arg.timeText}
        isStart={arg.isStart}
        allDay={arg.event.allDay}
      />
    );
  }, [eventsById, updateTask]);

  useEffect(() => {
    if (!expandedDate) return;
    const close = () => closeExpandedDay();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [expandedDate, closeExpandedDay]);

  useEffect(() => {
    if (!expandedDate) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeExpandedDay(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expandedDate, closeExpandedDay]);

  useEffect(() => {
    if (!filterPanelOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setFilterPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [filterPanelOpen]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!syncWarning) return;
    const timer = window.setTimeout(() => setSyncWarning(null), 5000);
    return () => window.clearTimeout(timer);
  }, [syncWarning]);

  // When the task board collapses, FullCalendar needs to re-measure its container
  useEffect(() => {
    const timer = window.setTimeout(() => {
      calendarRef.current?.getApi().updateSize();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [taskBoardExpanded]);

  // Shy-cursor hover effect was removed — it wrote inline transforms to every
  // visible .fc-event on every mousemove inside the calendar, which was
  // visibly janking pointer input on larger weeks. The cursor-trail dot alone
  // is enough of a cursor-tracking flourish.

  const dayHeaderContent = useCallback((args: { date: Date; text: string; isToday: boolean }) => {
    const { date, text, isToday } = args;
    // Month/year view headers have no digit (e.g. "Sun", "Mon") — keep default
    if (!/\d/.test(text)) return text;
    const dayName = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
    const dayNum = date.getDate();
    return (
      <div className="fc-day-header-custom">
        <span className="fc-day-header-name">{dayName}</span>
        <span className={isToday ? "fc-today-num-circle" : "fc-day-header-num"}>{dayNum}</span>
      </div>
    );
  }, []);

  const saveEvent = async (payload: { calendarId: string; event: GoogleEventPayload; eventId?: string }) => {
    try {
      const { calendarId, event, eventId } = payload;

      const response = await fetch(eventId ? `/api/google/events/${eventId}` : "/api/google/events", {
        method: eventId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          calendarId,
          event
        })
      });

      if (!response.ok) {
        throw new Error("Unable to save event");
      }

      // If this event was created from a dropped task/doc, attach the back-link
      // to the newly-created event so backlinks panels find it.
      if (!eventId && pendingLinkSourceRef.current) {
        try {
          const body = await response.clone().json() as { event?: { id?: string; calendarId?: string } };
          const createdId = body.event?.id;
          const createdCal = body.event?.calendarId ?? calendarId;
          if (createdId) {
            link(pendingLinkSourceRef.current, eventKey(createdCal, createdId));
          }
        } catch { /* body wasn't JSON — skip link */ }
        pendingLinkSourceRef.current = null;
      }

      await readEvents({ silent: true, force: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save event");
      throw saveError;
    }
  };

  const deleteEvent = async (event: CalendarEvent) => {
    try {
      const response = await fetch(`/api/google/events/${encodeURIComponent(event.id)}?calendarId=${encodeURIComponent(event.calendarId)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Unable to delete event");
      }

      setEventEditorOpen(false);
      await readEvents({ silent: true, force: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete event");
      throw deleteError;
    }
  };

  const updateMovedOrResizedEvent = async (change: EventChangeArg) => {
    // A scheduled task dragged or resized on the grid is still just a task:
    // write the new window back to the record. No Google round-trip, because
    // there is no separate event to keep in step.
    if (change.event.id.startsWith("task:")) {
      const taskId = change.event.id.slice("task:".length);
      updateTask(taskId, {
        start: change.event.startStr,
        end: change.event.endStr || undefined,
        allDay: change.event.allDay,
      });
      return;
    }

    const sep = change.event.id.indexOf("::");
    if (sep === -1) return;
    const calendarId = change.event.id.slice(0, sep);
    const eventId = change.event.id.slice(sep + 2);
    const current = events.find((item) => item.id === eventId && item.calendarId === calendarId);

    if (!current) return;

    const nextPayload: GoogleEventPayload = {
      title: current.title,
      description: current.description,
      location: current.location,
      allDay: current.allDay,
      start: change.event.startStr,
      end: change.event.endStr || current.end,
      attendees: current.attendees,
      recurrence: current.recurrence,
      reminders: current.reminders,
      eventType: current.eventType,
      colorId: current.colorId,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    try {
      const response = await fetch(`/api/google/events/${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          calendarId,
          event: nextPayload
        })
      });

      if (!response.ok) {
        change.revert();
        return;
      }

      await readEvents({ silent: true, force: true });
    } catch {
      change.revert();
    }
  };

  const createCalendar = async (input: { summary: string; description: string; backgroundColor: string }) => {
    try {
      const response = await fetch("/api/google/calendars", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });

      if (!response.ok) {
        throw new Error("Unable to create calendar");
      }

      await readCalendars();
    } catch (calendarError) {
      setError(calendarError instanceof Error ? calendarError.message : "Unable to create calendar");
      throw calendarError;
    }
  };

  return (
    <LayoutGroup>
    <UniversalDragLayer onDrop={handleUniversalDrop}>
    <motion.main 
      id="main-content"
      tabIndex={-1}
      className={`workspace${taskBoardExpanded ? " task-board-open" : ""}`} 
      ref={workspaceRef}
      style={{
        "--orb-blur": orbBlur,
        "--orb-opacity": orbOpacity
      } as React.CSSProperties}
    >
      {/* Orbs use pure CSS animations — no JS scheduler */}
      <div className="ambient-orb orb-a" />
      <div className="ambient-orb orb-b" />
      <div className="ambient-orb orb-c" />

      <AnimatePresence>
        {driveAuthError && (
          <motion.div
            key="drive-auth-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="drive-auth-banner"
          >
            <AlertTriangle size={14} />
            <span>milindDrive disconnected — your Google session expired.</span>
            <button onClick={() => void signIn("google")} className="drive-auth-reconnect">
              Reconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.section
        animate="show"
        className="calendar-shell"
        initial="hidden"
        style={{ height: calendarHeight }}
        variants={shellVariants}
      >
        <motion.div style={{ scale: calendarScale, y: calendarY, opacity: calendarOpacity, height: "100%", display: "flex", flexDirection: "column", minHeight: 0, transformOrigin: "50% 0%" }}>
        <header className="app-header">
          <motion.div className="header-identity" variants={itemVariants}>
            <BrandMark compact showTagline={false} layoutId="dive-app-brand" />
            <div className="header-meta">
              <span className="header-username">{userName.split(" ")[0]}'s calendar</span>
              <span className="header-sync-badge">
                {liveSyncMode === "live" ? "● Live sync" : "○ Polling"}
              </span>
            </div>
          </motion.div>

          <motion.div className="header-actions" variants={itemVariants}>
            <motion.button
              className="ghost-button"
              onClick={() => {
                eventsCacheRef.current.clear();
                fetchedWindowRef.current = null;
                void readEvents({ force: true });
              }}
              transition={springTransition}
              type="button"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw size={15} />
              <span className="btn-label">Refresh</span>
            </motion.button>
            <motion.button
              className="ghost-button"
              onClick={() => setCalendarDialogOpen(true)}
              transition={springTransition}
              type="button"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <CalendarPlus size={15} />
              <span className="btn-label">New calendar</span>
            </motion.button>
            <motion.button
              aria-label="Open milindDocs"
              className="ghost-button docs-toggle-btn"
              onClick={openDocs}
              title="Open milindDocs  ⌘D"
              transition={springTransition}
              type="button"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <FileText size={15} />
              <span className="btn-label">milindDocs</span>
              <kbd className="kbd-hint">⌘D</kbd>
            </motion.button>
            <motion.button
              className="primary-button"
              onClick={openNewEvent}
              transition={springTransition}
              type="button"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Sparkles size={15} />
              <span className="btn-label">New event</span>
            </motion.button>
            <AuthActions authenticated />
          </motion.div>
        </header>

        {/* Control strip */}
        <motion.div className="control-strip" ref={filterPanelRef} variants={itemVariants}>
          <div className="control-strip__bar">
            {/* Portal Button */}
            <motion.button
              aria-expanded={filterPanelOpen}
              className={`portal-btn${filterPanelOpen ? " portal-btn--open" : ""}`}
              onClick={() => setFilterPanelOpen((prev) => !prev)}
              transition={springTransition}
              type="button"
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="portal-btn__ring">
                <AnimatePresence initial={false} mode="wait">
                  {filterPanelOpen ? (
                    <motion.span
                      animate={{ rotate: 0, opacity: 1, scale: 1 }}
                      exit={{ rotate: 90, opacity: 0, scale: 0.4 }}
                      initial={{ rotate: -90, opacity: 0, scale: 0.4 }}
                      key="x-icon"
                      style={{ display: "flex" }}
                      transition={{ duration: 0.16 }}
                    >
                      <X size={11} />
                    </motion.span>
                  ) : (
                    <motion.span
                      animate={{ rotate: 0, opacity: 1, scale: 1 }}
                      exit={{ rotate: -90, opacity: 0, scale: 0.4 }}
                      initial={{ rotate: 90, opacity: 0, scale: 0.4 }}
                      key="layers-icon"
                      style={{ display: "flex" }}
                      transition={{ duration: 0.16 }}
                    >
                      <Layers size={11} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span aria-hidden className="portal-btn__shimmer" />
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  animate={{ opacity: 1, y: 0 }}
                  className="portal-btn__label"
                  exit={{ opacity: 0, y: -5 }}
                  initial={{ opacity: 0, y: 5 }}
                  key={filterPanelOpen ? "label-close" : "label-open"}
                  transition={{ duration: 0.14 }}
                >
                  {filterPanelOpen ? "Close panel" : "Views & Calendars"}
                </motion.span>
              </AnimatePresence>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  animate={{ scale: 1, opacity: 1 }}
                  className="portal-btn__count"
                  exit={{ scale: 0.6, opacity: 0 }}
                  initial={{ scale: 0.6, opacity: 0 }}
                  key={`count-${selectedCalendarIds.length}`}
                  transition={{ type: "spring", stiffness: 440, damping: 22 }}
                >
                  {selectedCalendarIds.length}
                </motion.span>
              </AnimatePresence>
            </motion.button>

            {/* Current view pill */}
            <motion.button
              className="view-pill"
              onClick={() => setFilterPanelOpen((prev) => !prev)}
              transition={springTransition}
              type="button"
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
            >
              {VIEW_LABELS[view]}
              <motion.span
                animate={{ rotate: filterPanelOpen ? 180 : 0 }}
                style={{ display: "flex" }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <ChevronDown size={11} />
              </motion.span>
            </motion.button>
          </div>

          {/* Filter panel dropdown */}
          <AnimatePresence initial={false}>
            {filterPanelOpen && (
              <motion.div
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                initial={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
              >
                <div className="filter-panel">
                  {/* View section */}
                  <div className="filter-panel__section">
                    <p className="filter-panel__section-label">
                      <span>View</span>
                    </p>
                    <motion.div className="view-switcher" layoutId="dive-view-pill">
                      {VIEW_OPTIONS.map((item) => (
                        <motion.button
                          animate={view === item.value ? { scale: 1.02 } : { scale: 1 }}
                          className={view === item.value ? "active" : ""}
                          key={item.value}
                          layout
                          onClick={() => {
                            changeView(item.value as CalendarView);
                            setFilterPanelOpen(false);
                          }}
                          transition={springTransition}
                          type="button"
                          whileHover={{ y: -2, scale: 1.03 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          {item.label}
                        </motion.button>
                      ))}
                    </motion.div>
                  </div>

                  {/* Calendars section */}
                  <div className="filter-panel__section filter-panel__section--calendars">
                    <p className="filter-panel__section-label">
                      <span>Calendars</span>
                      <span className="filter-panel__section-count">
                        {selectedCalendarIds.length} of {calendars.length} active
                      </span>
                    </p>
                    <div className="calendar-filter-row">
                      {calendars.map((calendar) => (
                        <motion.button
                          className={selectedCalendarIds.includes(calendar.id) ? "selected" : ""}
                          key={calendar.id}
                          layout
                          onClick={() =>
                            setSelectedCalendarIds((previous) =>
                              previous.includes(calendar.id)
                                ? previous.filter((id) => id !== calendar.id)
                                : [...previous, calendar.id]
                            )
                          }
                          style={{
                            borderColor: calendar.backgroundColor || "#4f8cff"
                          }}
                          transition={springTransition}
                          type="button"
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          {calendar.summary}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>


        {isCanvasView ? null : (
          <motion.div
            className={`calendar-frame ${loading ? "loading" : ""}${calendarDroppable.isOver ? " universal-droppable--active" : ""}`}
            ref={setCalendarFrameNode}
            style={{ height: "100%" }}
            transition={springTransition}
            variants={itemVariants}
          >
            {/* Custom Calendar Navigation */}
            <div className="cal-nav">
              <div className="cal-nav__controls">
                <motion.button
                  className="cal-nav__btn cal-nav__btn--arrow"
                  onClick={() => navigateCalendar("prev")}
                  type="button"
                  whileHover={{ scale: 1.12, x: -2 }}
                  whileTap={{ scale: 0.88, x: -4 }}
                  transition={{ type: "spring", stiffness: 500, damping: 15 }}
                >
                  <span className="cal-nav__btn-glow" />
                  <span className="cal-nav__btn-surface">
                    <ChevronLeft size={16} strokeWidth={2.5} />
                  </span>
                </motion.button>

                <motion.button
                  className="cal-nav__btn cal-nav__btn--arrow"
                  onClick={() => navigateCalendar("next")}
                  type="button"
                  whileHover={{ scale: 1.12, x: 2 }}
                  whileTap={{ scale: 0.88, x: 4 }}
                  transition={{ type: "spring", stiffness: 500, damping: 15 }}
                >
                  <span className="cal-nav__btn-glow" />
                  <span className="cal-nav__btn-surface">
                    <ChevronRight size={16} strokeWidth={2.5} />
                  </span>
                </motion.button>

                <motion.button
                  className="cal-nav__btn cal-nav__btn--today"
                  layoutId="dive-today-pill"
                  onClick={() => navigateCalendar("today")}
                  type="button"
                  whileHover={{ scale: 1.06, y: -1 }}
                  whileTap={{ scale: 0.94 }}
                  transition={{ type: "spring", stiffness: 500, damping: 15 }}
                >
                  <span className="cal-nav__btn-glow" />
                  <span className="cal-nav__btn-surface">
                    <Circle size={6} fill="currentColor" strokeWidth={0} />
                    <span>Today</span>
                  </span>
                </motion.button>
              </div>

              <AnimatePresence mode="wait">
                <motion.h2
                  className="cal-nav__title"
                  key={calendarTitle}
                  initial={{ opacity: 0, y: navDirection === "prev" ? -8 : navDirection === "next" ? 8 : 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: navDirection === "prev" ? 8 : navDirection === "next" ? -8 : 0, filter: "blur(4px)" }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                  {calendarTitle}
                </motion.h2>
              </AnimatePresence>
            </div>

            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 8 }}
              style={{ height: "100%" }}
              transition={{ duration: 0.36 }}
            >
              <FullCalendar
                allDaySlot
                dayHeaderContent={dayHeaderContent}
                datesSet={onDatesSet}
                dayMaxEvents={MONTH_DAY_EVENT_PREVIEW_LIMIT}
                editable
                eventClick={onEventClick}
                eventDrop={(arg) => void updateMovedOrResizedEvent(arg)}
                eventResize={(arg) => void updateMovedOrResizedEvent(arg)}
                eventContent={renderEventContent}
                events={fullCalendarEvents}
                headerToolbar={false}
                height={calendarHeight}
                initialView="timeGridWeek"
                moreLinkClick={onMoreLinkClick}
                moreLinkContent={moreLinkContent}
                nowIndicator
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin]}
                ref={calendarRef}
                scrollTime="06:30:00"
                scrollTimeReset={false}
                selectable
                unselectAuto={false}
                select={onSelectRange}
                slotMaxTime="24:00:00"
                slotMinTime="06:30:00"
                slotDuration="00:15:00"
                views={{
                  dayGridMonth: {
                    dayMaxEvents: MONTH_DAY_EVENT_PREVIEW_LIMIT
                  },
                  multiMonthYear: {
                    dayMaxEvents: MONTH_DAY_EVENT_PREVIEW_LIMIT
                  }
                }}
                weekends
              />
            </motion.div>
            <AnimatePresence>
              {loading ? (
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  className="loading-overlay"
                  exit={{ opacity: 0, x: 8 }}
                  initial={{ opacity: 0, x: 12 }}
                  key="loading"
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.span
                    animate={{ rotate: 360 }}
                    style={{ display: "flex" }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                  >
                    <Loader2 size={11} />
                  </motion.span>
                  Syncing
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
        </motion.div>
      </motion.section>

      <TasksSidebar onExpandChange={(expanded) => setTaskBoardExpanded(expanded)} />

      <AnimatePresence>
        {expandedDate && expandedAnchorRect ? (
          <>
            <motion.div
              animate={{ opacity: 1 }}
              aria-hidden
              className="day-expand-backdrop"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              onClick={closeExpandedDay}
              transition={{ duration: 0.15 }}
            />
            <motion.div
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="day-expand-panel"
              exit={{ opacity: 0, scale: 0.95, y: -6 }}
              initial={{ opacity: 0, scale: 0.94, y: -10 }}
              style={{
                top: expandedAnchorRect.top,
                left: expandedAnchorRect.left,
                width: Math.max(expandedAnchorRect.width, 200)
              }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="day-expand-header">
                <span>
                  {new Date(`${expandedDate}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "long",
                    day: "numeric"
                  })}
                </span>
                <button onClick={closeExpandedDay} type="button">✕</button>
              </div>
              <ul className="day-expand-events">
                {expandedDateEvents.map((event, index) => (
                  <motion.li
                    animate={{ opacity: 1, x: 0 }}
                    initial={{ opacity: 0, x: -8 }}
                    key={`${event.calendarId}::${event.id}`}
                    transition={{ duration: 0.18, delay: index * 0.04 }}
                  >
                    <button
                      className="day-expand-event"
                      onClick={() => {
                        setEditingEvent(event);
                        setDraftWindow({});
                        setEventEditorOpen(true);
                        closeExpandedDay();
                      }}
                      type="button"
                    >
                      <span className="day-expand-event-dot" style={{ background: event.color }} />
                      <span className="day-expand-event-body">
                        <span className="day-expand-event-title">{event.title}</span>
                        <span className="day-expand-event-time">
                          {event.allDay
                            ? "All day"
                            : new Date(event.start).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit"
                              })}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <EventEditor
        calendars={calendars}
        defaultCalendarId={selectedCalendarIds[0]}
        defaultEnd={draftWindow.end}
        defaultStart={draftWindow.start}
        defaultTitle={
          editorEntranceFrom === "doc"
            ? docPendingTitleRef.current
            : taskDropTitleRef.current || undefined
        }
        defaultDescription={
          editorEntranceFrom === "doc"
            ? docPendingDescriptionRef.current
            : taskDropDescriptionRef.current || undefined
        }
        entranceFrom={editorEntranceFrom}
        initialEvent={editingEvent}
        onClose={() => {
          setEventEditorOpen(false);
          setEditorEntranceFrom("side");
          docPendingTitleRef.current = "";
          docPendingDescriptionRef.current = "";
          taskDropTitleRef.current = "";
          taskDropDescriptionRef.current = "";
        }}
        onDelete={deleteEvent}
        onSubmit={saveEvent}
        onConvertToDoc={handleConvertToDoc}
        open={eventEditorOpen}
      />

      {/* Full-screen Canvas overlay — dramatic spring + blur transition */}
      <AnimatePresence>
        {isCanvasView && (
          <motion.div
            animate={{ y: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
            className="canvas-fullscreen"
            exit={{
              y: -60,
              scale: 0.97,
              opacity: 0,
              filter: "blur(8px)",
              transition: {
                y: { type: "spring", stiffness: 320, damping: 34 },
                scale: { type: "spring", stiffness: 320, damping: 34 },
                opacity: { duration: 0.28, ease: [0.4, 0, 1, 1] },
                filter: { duration: 0.22 }
              }
            }}
            initial={{ y: 90, scale: 0.95, opacity: 0, filter: "blur(14px)" }}
            transition={{
              y: { type: "spring", stiffness: 260, damping: 26 },
              scale: { type: "spring", stiffness: 260, damping: 26 },
              opacity: { duration: 0.38, ease: [0.16, 1, 0.3, 1] },
              filter: { duration: 0.45, ease: [0.16, 1, 0.3, 1] }
            }}
          >
            <motion.div
              animate="show"
              className="canvas-fullscreen-bar"
              initial="hidden"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.07, delayChildren: 0.18 } }
              }}
            >
              <motion.button
                className="ghost-button"
                onClick={() => changeView("timeGridWeek")}
                transition={springTransition}
                type="button"
                variants={{ hidden: { opacity: 0, x: -16 }, show: { opacity: 1, x: 0 } }}
                whileHover={{ x: -3, scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                ← Back to calendar
              </motion.button>
              <motion.span
                className="canvas-fullscreen-title"
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
              >
                <BrandMark compact={false} showTagline={false} />
                <span className="canvas-fullscreen-label">Canvas</span>
              </motion.span>
              <motion.button
                className="primary-button"
                onClick={openNewEvent}
                transition={springTransition}
                type="button"
                variants={{ hidden: { opacity: 0, x: 16 }, show: { opacity: 1, x: 0 } }}
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Sparkles size={15} />
                New event
              </motion.button>
            </motion.div>
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="canvas-fullscreen-body"
              initial={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.22, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <NodeCanvasView
                events={events}
                calendars={calendars}
                onSaveEvent={saveEvent}
                onOpenEvent={(event) => {
                  setEditingEvent(event);
                  setDraftWindow({});
                  setEventEditorOpen(true);
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <NewCalendarDialog
        onClose={() => setCalendarDialogOpen(false)}
        onCreate={createCalendar}
        open={calendarDialogOpen}
      />

      {/* ── milindDocs overlay ── */}
      {hasMountedDocs && (
        <motion.div
          className="docs-fullscreen"
          style={{
            y: docsY,
            scale: docsScale,
            opacity: docsOpacity,
            pointerEvents: docsVisible ? "auto" : "none",
            transformOrigin: "50% 100%",
          }}
        >
          <MilindDocsSection
            animationState={docsVisible ? "show" : "hidden"}
            onAddToCalendar={handleDocAddToCalendar}
            onAddToTodo={handleDocAddToTodo}
            onClose={closeDocs}
            onSendNoteToCanvas={handleSendNoteToCanvas}
            newDocFromCalendar={pendingCalendarDoc}
            calendarEvents={events}
            onSyncEventDescription={handleSyncEventDescription}
          />
        </motion.div>
      )}

      {/* Sync status pill — springs in from the top-center */}
      <div className="sync-status-anchor">
        <AnimatePresence mode="wait">
          {(error || syncWarning) && (
            <motion.div
              animate={{ y: 0, opacity: 1, scale: 1 }}
              className={`sync-status-pill ${error ? "sync-status-pill--error" : "sync-status-pill--warning"}`}
              exit={{ y: -16, opacity: 0, scale: 0.93, filter: "blur(2px)" }}
              initial={{ y: -28, opacity: 0, scale: 0.93, filter: "blur(4px)" }}
              key={error ? "error" : "warning"}
              transition={{ type: "spring", stiffness: 520, damping: 28 }}
            >
              <motion.span
                animate={{ rotate: [0, -8, 8, -4, 0] }}
                style={{ display: "flex" }}
                transition={{ delay: 0.18, duration: 0.5, ease: "easeOut" }}
              >
                {error ? <AlertCircle size={14} /> : <AlertTriangle size={14} />}
              </motion.span>
              <span className="sync-status-pill__text">{error ?? syncWarning}</span>
              <button
                className="sync-status-pill__dismiss"
                onClick={() => { setError(null); setSyncWarning(null); }}
                type="button"
              >
                <X size={10} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.main>
    </UniversalDragLayer>
    </LayoutGroup>
  );
}
