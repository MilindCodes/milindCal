"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import multiMonthPlugin from "@fullcalendar/multimonth";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import { AlertCircle, AlertTriangle, CalendarPlus, ChevronDown, Layers, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthActions } from "@/components/auth-actions";
import { BrandMark } from "@/components/brand-mark";
import { EventEditor } from "@/components/event-editor";
import { NewCalendarDialog } from "@/components/new-calendar-dialog";
import { MilindDocsSection } from "@/components/milind-docs-section";
import { NodeCanvasView } from "@/components/node-canvas-view";
import { TasksSidebar } from "@/components/tasks-sidebar";
import type { CalendarEvent, CalendarSummary, GoogleEventPayload, PanelNote } from "@/lib/models";

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

const shellVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.99 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.52,
      ease: [0.2, 0.8, 0.2, 1],
      when: "beforeChildren",
      staggerChildren: 0.06
    }
  }
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } }
} as const;

const MONTH_DAY_EVENT_PREVIEW_LIMIT = 5;

function getTextColorForBg(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Relative luminance (WCAG formula)
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.35 ? "#1a1a2e" : "#f0f4ff";
}

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

export function CalendarWorkspace({ userName }: CalendarWorkspaceProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarFrameRef = useRef<HTMLDivElement | null>(null);
  const syncVersionRef = useRef(0);
  const readEventsAbortRef = useRef<AbortController | null>(null);
  const readCalendarsAbortRef = useRef<AbortController | null>(null);
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<CalendarView>("timeGridWeek");
  const [range, setRange] = useState<{ start: string; end: string }>({
    start: new Date().toISOString(),
    end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 40).toISOString()
  });
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
  const [docsExitMode, setDocsExitMode] = useState<"normal" | "to-calendar">("normal");
  const [editorEntranceFrom, setEditorEntranceFrom] = useState<"side" | "doc">("side");
  const docPendingTitleRef = useRef<string>("");
  const docPendingDescriptionRef = useRef<string>("");
  const wheelAccRef = useRef(0);
  const stretchResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDocsAnimatingRef = useRef(false);
  const calendarStretchY = useMotionValue(0);
  const SNAP_THRESHOLD = 220;
  const MAX_STRETCH = 56;

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (isDocsAnimatingRef.current || docsVisible) return;

      const target = e.target as HTMLElement;
      // Let FullCalendar's internal scroller handle its own wheel events
      if (target.closest(".fc-scroller") || target.closest(".fc-timegrid-body")) return;

      if (e.deltaY > 0) {
        e.preventDefault();
        wheelAccRef.current = Math.min(wheelAccRef.current + e.deltaY, SNAP_THRESHOLD * 1.4);
        const progress = Math.min(wheelAccRef.current / SNAP_THRESHOLD, 1);
        calendarStretchY.set(-progress * MAX_STRETCH * 0.55);

        // Reset accumulator if user pauses scrolling
        if (stretchResetTimerRef.current) clearTimeout(stretchResetTimerRef.current);
        stretchResetTimerRef.current = setTimeout(() => {
          wheelAccRef.current = 0;
          void animate(calendarStretchY, 0, { type: "spring", stiffness: 360, damping: 24 });
        }, 180);

        if (wheelAccRef.current >= SNAP_THRESHOLD) {
          // ── SNAP TO DOCS ──
          if (stretchResetTimerRef.current) clearTimeout(stretchResetTimerRef.current);
          wheelAccRef.current = 0;
          isDocsAnimatingRef.current = true;
          // Quick overshoot then reset before docs flies in
          void animate(calendarStretchY, -MAX_STRETCH * 1.1, {
            type: "spring", stiffness: 360, damping: 18,
            onComplete: () => {
              void animate(calendarStretchY, 0, { duration: 0 });
              setDocsVisible(true);
              setTimeout(() => { isDocsAnimatingRef.current = false; }, 700);
            },
          });
        }
      } else {
        wheelAccRef.current = 0;
        if (!isDocsAnimatingRef.current) {
          void animate(calendarStretchY, 0, { type: "spring", stiffness: 360, damping: 24 });
        }
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [docsVisible, calendarStretchY]);

  const closeDocs = useCallback(() => {
    isDocsAnimatingRef.current = true;
    setDocsVisible(false);
    setTimeout(() => { isDocsAnimatingRef.current = false; }, 700);
  }, []);

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
    // Give docs overlay time to exit, then switch to canvas
    setTimeout(() => changeView("nodeCanvas"), 420);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeDocs]);
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

  const readEvents = useCallback(async (options?: { silent?: boolean }) => {
    readEventsAbortRef.current?.abort();
    const controller = new AbortController();
    readEventsAbortRef.current = controller;

    if (!selectedCalendarIds.length) {
      setEvents([]);
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }

    try {
      const query = new URLSearchParams({
        calendarIds: selectedCalendarIds.join(","),
        timeMin: range.start,
        timeMax: range.end
      });

      const response = await fetch(`/api/google/events?${query.toString()}`, { signal: controller.signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to load events");
      }

      const data = (await response.json()) as { events: CalendarEvent[]; failedCalendarIds?: string[] };
      setEvents(data.events);
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
    const renewTimer = window.setInterval(() => {
      void startWatch();
    }, 25 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(renewTimer);
    };
  }, [watchKey, selectedForSync]);

  useEffect(() => {
    const pollVersion = async () => {
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

        if (data.version > syncVersionRef.current) {
          syncVersionRef.current = data.version;
          await readEventsRef.current({ silent: true });
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

    void pollVersion();
    const versionTimer = window.setInterval(() => {
      void pollVersion();
    }, liveSyncMode === "live" ? 15_000 : 60_000);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(versionTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [liveSyncMode]);

  const fullCalendarEvents = useMemo<EventInput[]>(
    () =>
      events.map((event) => ({
        id: `${event.calendarId}::${event.id}`,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        backgroundColor: event.color,
        borderColor: event.color,
        textColor: event.color ? getTextColorForBg(event.color) : "#f0f4ff"
      })),
    [events]
  );

  const changeView = (nextView: CalendarView) => {
    setView(nextView);
    if (nextView !== "nodeCanvas") {
      calendarRef.current?.getApi().changeView(nextView);
    }
  };

  const onDatesSet = useCallback((args: DatesSetArg) => {
    setRange({
      start: args.start.toISOString(),
      end: args.end.toISOString()
    });
  }, []);

  const onSelectRange = (selection: any) => {
    setEditingEvent(null);
    setDraftWindow({
      start: selection.startStr,
      end: selection.endStr
    });
    setEventEditorOpen(true);
  };

  const openNewEvent = () => {
    setEditingEvent(null);
    setDraftWindow({
      start: new Date().toISOString(),
      end: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    setEventEditorOpen(true);
  };

  const onEventClick = (eventClick: EventClickArg) => {
    const sep = eventClick.event.id.indexOf("::");
    if (sep === -1) return;
    const calendarId = eventClick.event.id.slice(0, sep);
    const eventId = eventClick.event.id.slice(sep + 2);
    const found = events.find((event) => event.id === eventId && event.calendarId === calendarId);
    if (!found) return;

    setEditingEvent(found);
    setDraftWindow({});
    setEventEditorOpen(true);
  };

  const closeExpandedDay = useCallback(() => {
    setExpandedDate(null);
    setExpandedDateEvents([]);
    setExpandedAnchorRect(null);
  }, []);

  const onMoreLinkClick = useCallback((info: any) => {
    const dateStr = (info.date as Date).toISOString().split("T")[0];

    if (expandedDate === dateStr) {
      closeExpandedDay();
      return "none";
    }

    const target = info.jsEvent?.target as HTMLElement | null;
    const dayEl = target?.closest(".fc-daygrid-day");
    if (dayEl) {
      setExpandedAnchorRect(dayEl.getBoundingClientRect());
    }

    const seen = new Set<string>();
    const dayEvents = (info.allSegs as any[])
      .map((seg: any) => {
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

  // Shy cursor effect: events recoil from proximity, near side shrinks inward
  useEffect(() => {
    const container = calendarFrameRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const apply = (e: MouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const { clientX: cx, clientY: cy } = e;
        const THRESHOLD = 100;
        const MAX_FACTOR = 0.08;

        container.querySelectorAll<HTMLElement>(".fc-event").forEach((el) => {
          const r = el.getBoundingClientRect();
          const nearX = Math.max(r.left, Math.min(cx, r.right));
          const nearY = Math.max(r.top, Math.min(cy, r.bottom));
          const dist = Math.hypot(cx - nearX, cy - nearY);

          el.style.transition = "none";

          if (dist >= THRESHOLD) {
            el.style.transform = "";
            el.style.transformOrigin = "";
            return;
          }

          const t = 1 - dist / THRESHOLD;
          const scale = 1 - t * MAX_FACTOR;

          // Angle from event center to cursor; origin placed opposite (far side)
          const rcx = (r.left + r.right) / 2;
          const rcy = (r.top + r.bottom) / 2;
          const angle = Math.atan2(cy - rcy, cx - rcx);
          const ox = 50 + Math.cos(angle + Math.PI) * 50;
          const oy = 50 + Math.sin(angle + Math.PI) * 50;

          // Tiny scoot away from cursor (max 2px)
          const moveX = Math.cos(angle + Math.PI) * t * 2;
          const moveY = Math.sin(angle + Math.PI) * t * 2;

          el.style.transformOrigin = `${ox.toFixed(1)}% ${oy.toFixed(1)}%`;
          el.style.transform = `translate(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px) scale(${scale.toFixed(4)})`;
        });
      });
    };

    const reset = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      container.querySelectorAll<HTMLElement>(".fc-event").forEach((el) => {
        el.style.transition = "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
        el.style.transform = "";
        el.style.transformOrigin = "";
      });
    };

    container.addEventListener("mousemove", apply);
    container.addEventListener("mouseleave", reset);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener("mousemove", apply);
      container.removeEventListener("mouseleave", reset);
    };
  }, [view]);

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

      await readEvents({ silent: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save event");
      throw saveError;
    }
  };

  const deleteEvent = async (event: CalendarEvent) => {
    try {
      const response = await fetch(`/api/google/events/${event.id}?calendarId=${event.calendarId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error("Unable to delete event");
      }

      setEventEditorOpen(false);
      await readEvents({ silent: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete event");
      throw deleteError;
    }
  };

  const updateMovedOrResizedEvent = async (change: any) => {
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

    const response = await fetch(`/api/google/events/${eventId}`, {
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

    await readEvents({ silent: true });
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
    <main className={`workspace${taskBoardExpanded ? " task-board-open" : ""}`} ref={workspaceRef}>
      <motion.div
        animate={{
          x: [0, 14, -8, 0],
          y: [0, -12, 10, 0]
        }}
        className="ambient-orb orb-a"
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        animate={{
          x: [0, -20, 12, 0],
          y: [0, 16, -8, 0]
        }}
        className="ambient-orb orb-b"
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        animate={{
          x: [0, 12, -16, 0],
          y: [0, -8, 14, 0]
        }}
        className="ambient-orb orb-c"
        transition={{ duration: 30, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.section
        animate="show"
        className="calendar-shell"
        initial="hidden"
        style={{ y: calendarStretchY }}
        variants={shellVariants}
      >
        <header className="app-header">
          <motion.div className="header-identity" variants={itemVariants}>
            <BrandMark compact showTagline={false} />
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
              onClick={() => void readEvents()}
              transition={springTransition}
              type="button"
              whileHover={{ y: -2, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <RefreshCw size={15} />
              Refresh
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
              New calendar
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
              New event
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
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <div className="filter-panel">
                  {/* View section */}
                  <div className="filter-panel__section">
                    <p className="filter-panel__section-label">
                      <span>View</span>
                    </p>
                    <div className="view-switcher">
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
                    </div>
                  </div>

                  {/* Calendars section */}
                  <div className="filter-panel__section filter-panel__section--calendars">
                    <p className="filter-panel__section-label">
                      <span>Calendars</span>
                      <span className="filter-panel__section-count">
                        {selectedCalendarIds.length} of {calendars.length} active
                      </span>
                    </p>
                    <motion.div
                      animate="show"
                      className="calendar-filter-row"
                      initial="hidden"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } }
                      }}
                    >
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
                          variants={{
                            hidden: { opacity: 0, y: 8, scale: 0.95 },
                            show: { opacity: 1, y: 0, scale: 1 }
                          }}
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.96 }}
                        >
                          {calendar.summary}
                        </motion.button>
                      ))}
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>


        {isCanvasView ? null : (
          <motion.div
            className={`calendar-frame ${loading ? "loading" : ""}`}
            ref={calendarFrameRef}
            style={{ height: "100%" }}
            transition={springTransition}
            variants={itemVariants}
            whileHover={{ scale: 1.002 }}
          >
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
                events={fullCalendarEvents}
                headerToolbar={{
                  left: "prev,next today",
                  center: "title",
                  right: ""
                }}
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
        defaultTitle={editorEntranceFrom === "doc" ? docPendingTitleRef.current : undefined}
        defaultDescription={editorEntranceFrom === "doc" ? docPendingDescriptionRef.current : undefined}
        entranceFrom={editorEntranceFrom}
        initialEvent={editingEvent}
        onClose={() => {
          setEventEditorOpen(false);
          setEditorEntranceFrom("side");
          docPendingTitleRef.current = "";
          docPendingDescriptionRef.current = "";
        }}
        onDelete={deleteEvent}
        onSubmit={saveEvent}
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

      {/* ── milindDocs overlay — springs in from below ── */}
      <AnimatePresence>
        {docsVisible && (
          <motion.div
            animate={{ y: 0, opacity: 1, scale: 1, filter: "blur(0px)" }}
            className="docs-fullscreen"
            exit={docsExitMode === "to-calendar"
              ? {
                  y: "-22%",
                  opacity: 0,
                  scale: 0.93,
                  filter: "blur(5px)",
                  transition: { type: "spring", stiffness: 420, damping: 32 }
                }
              : {
                  y: "100vh",
                  opacity: 0.5,
                  scale: 0.97,
                  filter: "blur(0px)",
                  transition: { type: "spring", stiffness: 260, damping: 28 }
                }
            }
            initial={{ y: "100vh", opacity: 0.6, scale: 0.97, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 200, damping: 26 }}
          >
            <MilindDocsSection
              onAddToCalendar={handleDocAddToCalendar}
              onAddToTodo={handleDocAddToTodo}
              onClose={closeDocs}
              onSendNoteToCanvas={handleSendNoteToCanvas}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
    </main>
  );
}
