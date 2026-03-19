"use client";

import { AnimatePresence, motion } from "framer-motion";
import { addHours } from "date-fns";
import { type CSSProperties, memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { allDayEndToExclusive, allDayEndToInclusive, toDateOnly, toDateTimeLocal, toUtcRruleDate } from "@/lib/datetime";
import { EVENT_TYPES, type CalendarEvent, type CalendarSummary, type EventTypeId, type GoogleEventPayload } from "@/lib/models";

interface EventEditorSubmit {
  calendarId: string;
  eventId?: string;
  event: GoogleEventPayload;
}

interface EventEditorProps {
  calendars: CalendarSummary[];
  defaultCalendarId?: string;
  defaultStart?: string;
  defaultEnd?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  entranceFrom?: "side" | "doc";
  initialEvent?: CalendarEvent | null;
  onClose: () => void;
  onDelete: (event: CalendarEvent) => Promise<void>;
  onSubmit: (payload: EventEditorSubmit) => Promise<void>;
  open: boolean;
}

type Frequency = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

function parseRecurrence(rule: string | undefined) {
  if (!rule) {
    return { frequency: "NONE" as Frequency, interval: 1, until: "" };
  }

  const normalized = rule.replace("RRULE:", "");
  const parts = new Map(normalized.split(";").map((chunk) => {
    const [key, value] = chunk.split("=");
    return [key, value];
  }));

  const frequency = (parts.get("FREQ") as Frequency | undefined) ?? "NONE";
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const untilRaw = parts.get("UNTIL");
  const until = untilRaw ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}` : "";

  return {
    frequency,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    until
  };
}

export const EventEditor = memo(function EventEditor({
  calendars,
  defaultCalendarId,
  defaultStart,
  defaultEnd,
  defaultTitle,
  defaultDescription,
  entranceFrom = "side",
  initialEvent,
  onClose,
  onDelete,
  onSubmit,
  open
}: EventEditorProps) {
  const parsedRecurrence = useMemo(() => parseRecurrence(initialEvent?.recurrence?.[0]), [initialEvent?.recurrence]);

  const [calendarId, setCalendarId] = useState(defaultCalendarId ?? "primary");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [attendeesRaw, setAttendeesRaw] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startDateTime, setStartDateTime] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [startDateOnly, setStartDateOnly] = useState("");
  const [endDateOnly, setEndDateOnly] = useState("");
  const [eventType, setEventType] = useState<EventTypeId>("meeting");
  const [frequency, setFrequency] = useState<Frequency>("NONE");
  const [interval, setInterval] = useState(1);
  const [until, setUntil] = useState("");
  const [popupMinutes, setPopupMinutes] = useState("10");
  const [emailMinutes, setEmailMinutes] = useState("60");
  const [useDefaultReminders, setUseDefaultReminders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open) return;

    const now = new Date();
    const fallbackStart = defaultStart ?? now.toISOString();
    const fallbackEnd = defaultEnd ?? addHours(now, 1).toISOString();

    if (!initialEvent) {
      setCalendarId(defaultCalendarId ?? "primary");
      setTitle(defaultTitle ?? "");
      setDescription(defaultDescription ?? "");
      setLocation("");
      setAttendeesRaw("");
      setAllDay(false);
      setStartDateTime(toDateTimeLocal(fallbackStart));
      setEndDateTime(toDateTimeLocal(fallbackEnd));
      setStartDateOnly(toDateOnly(fallbackStart));
      setEndDateOnly(toDateOnly(fallbackEnd));
      setEventType("meeting");
      setFrequency("NONE");
      setInterval(1);
      setUntil("");
      setPopupMinutes("10");
      setEmailMinutes("60");
      setUseDefaultReminders(false);
      setShowMore(Boolean(defaultDescription));
      return;
    }

    setCalendarId(initialEvent.calendarId);
    setTitle(initialEvent.title);
    setDescription(initialEvent.description);
    setLocation(initialEvent.location);
    setAttendeesRaw(initialEvent.attendees.join(", "));
    setAllDay(initialEvent.allDay);
    setStartDateTime(toDateTimeLocal(initialEvent.start));
    setEndDateTime(toDateTimeLocal(initialEvent.end));
    setStartDateOnly(toDateOnly(initialEvent.start));
    setEndDateOnly(initialEvent.allDay ? allDayEndToInclusive(initialEvent.end) : toDateOnly(initialEvent.end));
    setEventType(initialEvent.eventType);
    setFrequency(parsedRecurrence.frequency);
    setInterval(parsedRecurrence.interval);
    setUntil(parsedRecurrence.until);

    const popupReminder = initialEvent.reminders.overrides.find((item) => item.method === "popup")?.minutes;
    const emailReminder = initialEvent.reminders.overrides.find((item) => item.method === "email")?.minutes;

    setPopupMinutes(String(popupReminder ?? 10));
    setEmailMinutes(String(emailReminder ?? 60));
    setUseDefaultReminders(initialEvent.reminders.useDefault);

    // Auto-expand more options if the event has extra data populated
    const hasExtra =
      Boolean(initialEvent.location) ||
      initialEvent.attendees.length > 0 ||
      Boolean(initialEvent.description) ||
      parsedRecurrence.frequency !== "NONE" ||
      !initialEvent.reminders.useDefault;
    setShowMore(hasExtra);
  }, [defaultCalendarId, defaultDescription, defaultEnd, defaultStart, defaultTitle, initialEvent, open, parsedRecurrence]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitError(null);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = allDay ? startDateOnly : new Date(startDateTime).toISOString();
    const end = allDay ? allDayEndToExclusive(endDateOnly || startDateOnly) : new Date(endDateTime).toISOString();

    const recurrence =
      frequency === "NONE"
        ? []
        : [
            `RRULE:FREQ=${frequency};INTERVAL=${interval}${
              until ? `;UNTIL=${toUtcRruleDate(until)}` : ""
            }`
          ];

    const reminders = useDefaultReminders
      ? {
          useDefault: true,
          overrides: []
        }
      : {
          useDefault: false,
          overrides: [
            { method: "popup" as const, minutes: Number(popupMinutes || 10) },
            { method: "email" as const, minutes: Number(emailMinutes || 60) }
          ]
        };

    const event: GoogleEventPayload = {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      start,
      end,
      allDay,
      attendees: attendeesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      recurrence,
      reminders,
      eventType,
      colorId: EVENT_TYPES.find((item) => item.id === eventType)?.googleColorId ?? "9",
      timeZone
    };

    setIsSubmitting(true);
    try {
      await onSubmit({
        calendarId,
        event,
        eventId: initialEvent?.id
      });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save event");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
          <motion.div
            key="event-popout"
            animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            className="event-popout"
            exit={entranceFrom === "doc"
              ? { y: 16, opacity: 0, scale: 0.97, transition: { type: "spring", stiffness: 360, damping: 32 } }
              : { x: 56, opacity: 0, scale: 0.97, transition: { type: "spring", stiffness: 340, damping: 34 } }
            }
            initial={entranceFrom === "doc"
              ? { x: 0, y: 28, opacity: 0, scale: 0.96 }
              : { x: 56, y: 0, opacity: 0, scale: 0.97 }
            }
            transition={entranceFrom === "doc"
              ? { type: "spring", stiffness: 380, damping: 30 }
              : { type: "spring", stiffness: 340, damping: 34 }
            }
          >
          {/* ── Header ── */}
          <div className="event-popout__header">
            <span className="event-popout__eyebrow">
              {initialEvent ? "Edit event" : "New event"}
            </span>
            <motion.button
              aria-label="Close"
              className="event-popout__close"
              onClick={onClose}
              type="button"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <X size={13} />
            </motion.button>
          </div>

          {/* ── Scrollable body ── */}
          <div className="event-popout__body">

            {/* Title */}
            <input
              autoFocus
              className="event-popout__title-input"
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              value={title}
            />

            {/* Event type color pills */}
            <div className="event-type-pills">
              {EVENT_TYPES.map((t) => (
                <motion.button
                  key={t.id}
                  className={`event-type-pill${eventType === t.id ? " event-type-pill--active" : ""}`}
                  style={{ "--pill-color": t.color } as CSSProperties}
                  onClick={() => setEventType(t.id)}
                  type="button"
                  whileHover={{ scale: 1.05, y: -1 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 380, damping: 26 }}
                >
                  {t.label}
                </motion.button>
              ))}
            </div>

            {/* Calendar */}
            <label className="event-popout__label-group">
              <span className="event-popout__field-label">Calendar</span>
              <select
                className="event-popout__select"
                onChange={(e) => setCalendarId(e.target.value)}
                value={calendarId}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                  </option>
                ))}
              </select>
            </label>

            {/* All-day toggle */}
            <div className="toggle-row">
              <span>All day</span>
              <button
                className={`toggle ${allDay ? "on" : ""}`}
                onClick={() => setAllDay((v) => !v)}
                type="button"
              >
                <span />
              </button>
            </div>

            {/* Date / time inputs */}
            {allDay ? (
              <div className="inline-grid two">
                <label>
                  Start date
                  <input
                    onChange={(e) => setStartDateOnly(e.target.value)}
                    type="date"
                    value={startDateOnly}
                  />
                </label>
                <label>
                  End date
                  <input
                    onChange={(e) => setEndDateOnly(e.target.value)}
                    type="date"
                    value={endDateOnly}
                  />
                </label>
              </div>
            ) : (
              <div className="inline-grid two">
                <label>
                  Start
                  <input
                    onChange={(e) => setStartDateTime(e.target.value)}
                    type="datetime-local"
                    value={startDateTime}
                  />
                </label>
                <label>
                  End
                  <input
                    onChange={(e) => setEndDateTime(e.target.value)}
                    type="datetime-local"
                    value={endDateTime}
                  />
                </label>
              </div>
            )}

            {/* More options toggle */}
            <motion.button
              className="event-popout__more-toggle"
              onClick={() => setShowMore((v) => !v)}
              type="button"
              whileHover={{ backgroundColor: "rgba(127, 29, 29, 0.07)" }}
              whileTap={{ scale: 0.98 }}
            >
              <span>{showMore ? "Fewer options" : "More options"}</span>
              <motion.span
                animate={{ rotate: showMore ? 180 : 0 }}
                style={{ display: "flex" }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              >
                <ChevronDown size={13} />
              </motion.span>
            </motion.button>

            {/* ── Expandable advanced section ── */}
            <AnimatePresence initial={false}>
              {showMore ? (
                <motion.div
                  key="more-fields"
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  initial={{ height: 0, opacity: 0 }}
                  style={{ overflow: "hidden" }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <div className="event-popout__more-body">
                    <label>
                      Location
                      <input
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Conference room / address"
                        value={location}
                      />
                    </label>

                    <label>
                      Attendees
                      <input
                        onChange={(e) => setAttendeesRaw(e.target.value)}
                        placeholder="name@company.com, second@company.com"
                        value={attendeesRaw}
                      />
                    </label>

                    <label>
                      Description
                      <textarea
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        value={description}
                      />
                    </label>

                    <div className="inline-grid two">
                      <label>
                        Repeat
                        <select
                          onChange={(e) => setFrequency(e.target.value as Frequency)}
                          value={frequency}
                        >
                          <option value="NONE">None</option>
                          <option value="DAILY">Daily</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="MONTHLY">Monthly</option>
                          <option value="YEARLY">Yearly</option>
                        </select>
                      </label>
                      {frequency !== "NONE" ? (
                        <label>
                          Interval
                          <input
                            min={1}
                            onChange={(e) => setInterval(Number(e.target.value))}
                            type="number"
                            value={interval}
                          />
                        </label>
                      ) : (
                        <span />
                      )}
                    </div>

                    {frequency !== "NONE" ? (
                      <label>
                        Until
                        <input
                          onChange={(e) => setUntil(e.target.value)}
                          type="date"
                          value={until}
                        />
                      </label>
                    ) : null}

                    <div className="toggle-row">
                      <span>Use default reminders</span>
                      <button
                        className={`toggle ${useDefaultReminders ? "on" : ""}`}
                        onClick={() => setUseDefaultReminders((v) => !v)}
                        type="button"
                      >
                        <span />
                      </button>
                    </div>

                    {!useDefaultReminders ? (
                      <div className="inline-grid two">
                        <label>
                          Popup (min)
                          <input
                            min={0}
                            onChange={(e) => setPopupMinutes(e.target.value)}
                            type="number"
                            value={popupMinutes}
                          />
                        </label>
                        <label>
                          Email (min)
                          <input
                            min={0}
                            onChange={(e) => setEmailMinutes(e.target.value)}
                            type="number"
                            value={emailMinutes}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {submitError ? <p className="error-line">{submitError}</p> : null}
          </div>

          {/* ── Footer ── */}
          <div className="event-popout__footer">
            {initialEvent ? (
              <motion.button
                className="danger-button"
                onClick={() => void onDelete(initialEvent)}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                Delete
              </motion.button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <motion.button
                className="ghost-button"
                onClick={onClose}
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                Cancel
              </motion.button>
              <motion.button
                className="primary-button"
                disabled={isSubmitting || !title.trim()}
                onClick={submit}
                type="button"
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                {isSubmitting ? "Saving…" : initialEvent ? "Save" : "Create"}
              </motion.button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
});
