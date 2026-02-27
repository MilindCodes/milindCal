"use client";

import { AnimatePresence, motion } from "framer-motion";
import { addHours } from "date-fns";
import { useEffect, useMemo, useState } from "react";
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

export function EventEditor({
  calendars,
  defaultCalendarId,
  defaultStart,
  defaultEnd,
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

  useEffect(() => {
    if (!open) return;

    const now = new Date();
    const fallbackStart = defaultStart ?? now.toISOString();
    const fallbackEnd = defaultEnd ?? addHours(now, 1).toISOString();

    if (!initialEvent) {
      setCalendarId(defaultCalendarId ?? "primary");
      setTitle("");
      setDescription("");
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
  }, [defaultCalendarId, defaultEnd, defaultStart, initialEvent, open, parsedRecurrence]);

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
        <motion.div animate={{ opacity: 1 }} className="overlay" exit={{ opacity: 0 }} initial={{ opacity: 0 }}>
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="dialog event-dialog"
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
          >
            <h3>{initialEvent ? "Edit event" : "Create event"}</h3>

            <label>
              Title
              <input onChange={(event) => setTitle(event.target.value)} placeholder="Team sync" value={title} />
            </label>

            <label>
              Calendar
              <select onChange={(event) => setCalendarId(event.target.value)} value={calendarId}>
                {calendars.map((calendar) => (
                  <option key={calendar.id} value={calendar.id}>
                    {calendar.summary}
                  </option>
                ))}
              </select>
            </label>

            <div className="toggle-row">
              <span>All day</span>
              <button className={`toggle ${allDay ? "on" : ""}`} onClick={() => setAllDay((value) => !value)} type="button">
                <span />
              </button>
            </div>

            {allDay ? (
              <div className="inline-grid two">
                <label>
                  Start date
                  <input onChange={(event) => setStartDateOnly(event.target.value)} type="date" value={startDateOnly} />
                </label>
                <label>
                  End date
                  <input onChange={(event) => setEndDateOnly(event.target.value)} type="date" value={endDateOnly} />
                </label>
              </div>
            ) : (
              <div className="inline-grid two">
                <label>
                  Start
                  <input onChange={(event) => setStartDateTime(event.target.value)} type="datetime-local" value={startDateTime} />
                </label>
                <label>
                  End
                  <input onChange={(event) => setEndDateTime(event.target.value)} type="datetime-local" value={endDateTime} />
                </label>
              </div>
            )}

            <div className="inline-grid two">
              <label>
                Event type
                <select onChange={(event) => setEventType(event.target.value as EventTypeId)} value={eventType}>
                  {EVENT_TYPES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Recurrence
                <select onChange={(event) => setFrequency(event.target.value as Frequency)} value={frequency}>
                  <option value="NONE">None</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </label>
            </div>

            {frequency !== "NONE" ? (
              <div className="inline-grid two">
                <label>
                  Interval
                  <input min={1} onChange={(event) => setInterval(Number(event.target.value))} type="number" value={interval} />
                </label>
                <label>
                  Until
                  <input onChange={(event) => setUntil(event.target.value)} type="date" value={until} />
                </label>
              </div>
            ) : null}

            <label>
              Attendees
              <input
                onChange={(event) => setAttendeesRaw(event.target.value)}
                placeholder="name@company.com, second@company.com"
                value={attendeesRaw}
              />
            </label>

            <label>
              Location
              <input onChange={(event) => setLocation(event.target.value)} placeholder="Conference room / address" value={location} />
            </label>

            <label>
              Description
              <textarea onChange={(event) => setDescription(event.target.value)} rows={4} value={description} />
            </label>

            <div className="toggle-row">
              <span>Use default Google reminders</span>
              <button
                className={`toggle ${useDefaultReminders ? "on" : ""}`}
                onClick={() => setUseDefaultReminders((value) => !value)}
                type="button"
              >
                <span />
              </button>
            </div>

            {!useDefaultReminders ? (
              <div className="inline-grid two">
                <label>
                  Popup reminder (minutes before)
                  <input
                    min={0}
                    onChange={(event) => setPopupMinutes(event.target.value)}
                    type="number"
                    value={popupMinutes}
                  />
                </label>
                <label>
                  Email reminder (minutes before)
                  <input
                    min={0}
                    onChange={(event) => setEmailMinutes(event.target.value)}
                    type="number"
                    value={emailMinutes}
                  />
                </label>
              </div>
            ) : null}

            {submitError ? <p className="error-line">{submitError}</p> : null}

            <div className="dialog-actions">
              {initialEvent ? (
                <button className="danger-button" onClick={() => void onDelete(initialEvent)} type="button">
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div>
                <button className="ghost-button" onClick={onClose} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={isSubmitting || !title.trim()} onClick={submit} type="button">
                  {initialEvent ? "Save" : "Create"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
