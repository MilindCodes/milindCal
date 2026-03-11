"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import multiMonthPlugin from "@fullcalendar/multimonth";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import { motion } from "framer-motion";
import { CalendarPlus, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthActions } from "@/components/auth-actions";
import { BrandMark } from "@/components/brand-mark";
import { EventEditor } from "@/components/event-editor";
import { NewCalendarDialog } from "@/components/new-calendar-dialog";
import { TasksSidebar } from "@/components/tasks-sidebar";
import type { CalendarEvent, CalendarSummary, GoogleEventPayload } from "@/lib/models";

type CalendarView = "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "multiMonthYear";

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

export function CalendarWorkspace({ userName }: CalendarWorkspaceProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const syncVersionRef = useRef(0);
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
  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [draftWindow, setDraftWindow] = useState<EditorDraftWindow>({});
  const [liveSyncMode, setLiveSyncMode] = useState<"connecting" | "live" | "fallback">("connecting");
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const calendarHeight = view === "timeGridDay" || view === "timeGridWeek" ? "78vh" : "auto";

  const readCalendars = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/google/calendars");
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
      setError(loadError instanceof Error ? loadError.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  const readEvents = useCallback(async (options?: { silent?: boolean }) => {
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

      const response = await fetch(`/api/google/events?${query.toString()}`);
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
          await readEvents({ silent: true });
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
  }, [liveSyncMode, readEvents]);

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
        textColor: "#e2e8f0"
      })),
    [events]
  );

  const changeView = (nextView: CalendarView) => {
    setView(nextView);
    calendarRef.current?.getApi().changeView(nextView);
  };

  const onDatesSet = (args: DatesSetArg) => {
    setRange({
      start: args.start.toISOString(),
      end: args.end.toISOString()
    });
  };

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
    const [calendarId, eventId] = eventClick.event.id.split("::");
    const found = events.find((event) => event.id === eventId && event.calendarId === calendarId);
    if (!found) return;

    setEditingEvent(found);
    setDraftWindow({});
    setEventEditorOpen(true);
  };

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
    const [calendarId, eventId] = change.event.id.split("::");
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
    <main className="workspace">
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
        variants={shellVariants}
        whileHover={{ y: -2 }}
      >
        <header className="app-header">
          <motion.div variants={itemVariants}>
            <BrandMark compact showTagline />
            <p className="eyebrow">Google sync enabled</p>
            <h1>{userName.split(" ")[0]}'s calendar</h1>
            <p className="subtle-status">
              Sync mode: {liveSyncMode === "live" ? "Push + instant refresh" : "Polling fallback"}
            </p>
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

        <motion.section className="toolbar-row" variants={itemVariants}>
          <motion.div className="view-switcher" variants={itemVariants}>
            {[
              { label: "Day", value: "timeGridDay" },
              { label: "Week", value: "timeGridWeek" },
              { label: "Month", value: "dayGridMonth" },
              { label: "Year", value: "multiMonthYear" }
            ].map((item) => (
              <motion.button
                className={view === item.value ? "active" : ""}
                key={item.value}
                onClick={() => changeView(item.value as CalendarView)}
                transition={springTransition}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
              >
                {item.label}
              </motion.button>
            ))}
          </motion.div>

          <motion.div className="calendar-filter-row" variants={itemVariants}>
            {calendars.map((calendar) => (
              <motion.button
                className={selectedCalendarIds.includes(calendar.id) ? "selected" : ""}
                key={calendar.id}
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
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
              >
                {calendar.summary}
              </motion.button>
            ))}
          </motion.div>
        </motion.section>

        {error ? <p className="error-line">{error}</p> : null}
        {syncWarning ? <p className="warning-line">{syncWarning}</p> : null}

        <motion.div
          className={`calendar-frame ${loading ? "loading" : ""}`}
          transition={springTransition}
          variants={itemVariants}
          whileHover={{ scale: 1.002 }}
        >
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.36 }}
          >
            <FullCalendar
              allDaySlot
              datesSet={onDatesSet}
              dayMaxEvents={5}
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
            nowIndicator
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin]}
            ref={calendarRef}
            scrollTime="06:30:00"
            scrollTimeReset={false}
            selectable
            select={onSelectRange}
            slotMaxTime="24:00:00"
            slotMinTime="06:30:00"
            slotDuration="00:15:00"
            weekends
          />
          </motion.div>
          {loading ? <p className="loading-overlay">Syncing calendars...</p> : null}
        </motion.div>
      </motion.section>

      <TasksSidebar />

      <EventEditor
        calendars={calendars}
        defaultCalendarId={selectedCalendarIds[0]}
        defaultEnd={draftWindow.end}
        defaultStart={draftWindow.start}
        initialEvent={editingEvent}
        onClose={() => setEventEditorOpen(false)}
        onDelete={deleteEvent}
        onSubmit={saveEvent}
        open={eventEditorOpen}
      />

      <NewCalendarDialog
        onClose={() => setCalendarDialogOpen(false)}
        onCreate={createCalendar}
        open={calendarDialogOpen}
      />
    </main>
  );
}
