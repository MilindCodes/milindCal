"use client";

import { AnimatePresence, motion } from "framer-motion";
import { memo, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, X } from "lucide-react";
import { allDayEndToExclusive, allDayEndToInclusive, toDateOnly, toDateTimeLocal, toUtcRruleDate } from "@/lib/datetime";
import { BacklinksList } from "@/components/backlinks-list";
import { eventKey } from "@/lib/entity-store";
import { GOOGLE_EVENT_COLORS, type CalendarEvent, type CalendarSummary, type EventTypeId, type GoogleEventPayload } from "@/lib/models";

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
  onConvertToDoc?: (event: CalendarEvent) => void;
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

function rgbFromHex(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    r: Number.isNaN(r) ? 0 : r,
    g: Number.isNaN(g) ? 0 : g,
    b: Number.isNaN(b) ? 0 : b,
  };
}

function nearestGoogleColorId(hex: string): string {
  const { r, g, b } = rgbFromHex(hex);
  let minDist = Infinity;
  let nearest = "9";
  for (const color of GOOGLE_EVENT_COLORS) {
    const cr = parseInt(color.hex.slice(1, 3), 16);
    const cg = parseInt(color.hex.slice(3, 5), 16);
    const cb = parseInt(color.hex.slice(5, 7), 16);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < minDist) {
      minDist = dist;
      nearest = color.id;
    }
  }
  return nearest;
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
  onConvertToDoc,
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
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [until, setUntil] = useState("");
  const [popupMinutes, setPopupMinutes] = useState("10");
  const [emailMinutes, setEmailMinutes] = useState("60");
  const [useDefaultReminders, setUseDefaultReminders] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [eventColorHex, setEventColorHex] = useState("#5484ed");
  const [showColorWheel, setShowColorWheel] = useState(false);
  const [hexInputValue, setHexInputValue] = useState("#5484ed");

  // Keep hex text input in sync when color changes from swatch / wheel
  useEffect(() => {
    setHexInputValue(eventColorHex);
  }, [eventColorHex]);

  /* Escape closes, and focus goes back where it came from.
   *
   * Neither happened before. A keyboard user could open the editor, land in
   * the title field, and have no way out except tabbing to Cancel — and on
   * close, focus fell to the document body, so the next Tab started from the
   * top of the page instead of the control they had just used.
   *
   * `capture` so the key is handled before an inner control (the colour
   * popover, a select) can swallow it. */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Only pull focus back if it is still inside the editor; if the user
      // has clicked elsewhere in the meantime, leave it where they put it.
      const returnTo = restoreFocusRef.current;
      if (returnTo && document.body.contains(returnTo)) {
        const active = document.activeElement;
        if (!active || active === document.body) returnTo.focus();
      }
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const now = new Date();
    const fallbackStart = defaultStart ?? now.toISOString();
    const fallbackEnd = defaultEnd ?? new Date(now.getTime() + 60 * 60 * 1000).toISOString();

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
      setRecurrenceInterval(1);
      setUntil("");
      setPopupMinutes("10");
      setEmailMinutes("60");
      setUseDefaultReminders(false);
      setShowMore(Boolean(defaultDescription));
      setShowColorWheel(false);
      const cal = calendars.find((c) => c.id === (defaultCalendarId ?? "primary"));
      setEventColorHex(cal?.backgroundColor ?? "#5484ed");
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
    setRecurrenceInterval(parsedRecurrence.interval);
    setUntil(parsedRecurrence.until);

    const popupReminder = initialEvent.reminders.overrides.find((item) => item.method === "popup")?.minutes;
    const emailReminder = initialEvent.reminders.overrides.find((item) => item.method === "email")?.minutes;

    setPopupMinutes(String(popupReminder ?? 10));
    setEmailMinutes(String(emailReminder ?? 60));
    setUseDefaultReminders(initialEvent.reminders.useDefault);
    setShowColorWheel(false);

    const googleColor = GOOGLE_EVENT_COLORS.find((c) => c.id === initialEvent.colorId);
    setEventColorHex(googleColor?.hex ?? initialEvent.color ?? "#5484ed");

    const hasExtra =
      Boolean(initialEvent.location) ||
      initialEvent.attendees.length > 0 ||
      Boolean(initialEvent.description) ||
      parsedRecurrence.frequency !== "NONE" ||
      !initialEvent.reminders.useDefault;
    setShowMore(hasExtra);
  }, [calendars, defaultCalendarId, defaultDescription, defaultEnd, defaultStart, defaultTitle, initialEvent, open, parsedRecurrence]);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitError(null);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = allDay ? startDateOnly : new Date(startDateTime).toISOString();
    const end = allDay ? allDayEndToExclusive(endDateOnly || startDateOnly) : new Date(endDateTime).toISOString();

    // Validate that end is after start
    if (allDay) {
      if ((endDateOnly || startDateOnly) < startDateOnly) {
        setSubmitError("End date must be on or after the start date");
        return;
      }
    } else {
      if (new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) {
        setSubmitError("End time must be after start time");
        return;
      }
    }

    const recurrence =
      frequency === "NONE"
        ? []
        : [
            `RRULE:FREQ=${frequency};INTERVAL=${recurrenceInterval}${
              until ? `;UNTIL=${toUtcRruleDate(until)}` : ""
            }`
          ];

    const reminders = useDefaultReminders
      ? { useDefault: true, overrides: [] }
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
      colorId: nearestGoogleColorId(eventColorHex),
      timeZone
    };

    setIsSubmitting(true);
    try {
      await onSubmit({ calendarId, event, eventId: initialEvent?.id });
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save event");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCustomColor = !GOOGLE_EVENT_COLORS.some(
    (c) => c.hex.toLowerCase() === eventColorHex.toLowerCase()
  );
  const { r, g, b } = rgbFromHex(eventColorHex);

  const handleRgbChange = (ch: "r" | "g" | "b", val: string) => {
    const n = Math.min(255, Math.max(0, parseInt(val) || 0));
    const current = rgbFromHex(eventColorHex);
    const updated = { ...current, [ch]: n };
    setEventColorHex(
      `#${updated.r.toString(16).padStart(2, "0")}${updated.g.toString(16).padStart(2, "0")}${updated.b.toString(16).padStart(2, "0")}`
    );
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
          <div
            className="event-popout__body"
            onWheel={(e) => e.stopPropagation()}
          >
            {/* Title */}
            <input
              autoFocus
              className="event-popout__title-input"
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              value={title}
            />

            {/* Calendar selection pills */}
            <div className="event-popout__field-section">
              <span className="event-popout__field-label">Calendar</span>
              <div className="event-type-pills">
                {calendars.map((cal) => (
                  <motion.button
                    key={cal.id}
                    className={`event-type-pill${calendarId === cal.id ? " event-type-pill--active" : ""}`}
                    style={{ "--pill-color": cal.backgroundColor ?? "#4f8cff" } as CSSProperties}
                    onClick={() => setCalendarId(cal.id)}
                    type="button"
                    whileHover={{ scale: 1.05, y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 380, damping: 26 }}
                  >
                    {cal.summary}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Event color */}
            <div className="event-popout__field-section">
              <span className="event-popout__field-label">
                Color
                <span
                  className="color-preview-dot"
                  style={{ background: eventColorHex }}
                />
              </span>
              <div className="color-swatch-row">
                {GOOGLE_EVENT_COLORS.map((color) => (
                  <motion.button
                    key={color.id}
                    className={`color-swatch${!isCustomColor && eventColorHex.toLowerCase() === color.hex.toLowerCase() ? " color-swatch--active" : ""}`}
                    style={{ background: color.hex }}
                    onClick={() => { setEventColorHex(color.hex); setShowColorWheel(false); }}
                    title={color.name}
                    type="button"
                    whileHover={{ scale: 1.18 }}
                    whileTap={{ scale: 0.9 }}
                  />
                ))}
                {/* Custom color swatch */}
                <motion.button
                  className={`color-swatch color-swatch--custom${isCustomColor || showColorWheel ? " color-swatch--active" : ""}`}
                  onClick={() => setShowColorWheel((v) => !v)}
                  title="Custom color"
                  type="button"
                  whileHover={{ scale: 1.18 }}
                  whileTap={{ scale: 0.9 }}
                />
              </div>

              {/* Custom color wheel + RGB panel */}
              <AnimatePresence initial={false}>
                {showColorWheel ? (
                  <motion.div
                    key="color-wheel"
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                    style={{ overflow: "hidden" }}
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  >
                    <div className="color-wheel-panel">
                      <div className="color-wheel-row">
                        <input
                          className="color-wheel-input"
                          onChange={(e) => setEventColorHex(e.target.value)}
                          type="color"
                          value={eventColorHex}
                        />
                        <input
                          className="hex-input"
                          maxLength={7}
                          onChange={(e) => {
                            const v = e.target.value;
                            setHexInputValue(v);
                            if (/^#[0-9A-Fa-f]{6}$/.test(v)) setEventColorHex(v);
                          }}
                          placeholder="#5484ed"
                          value={hexInputValue}
                        />
                      </div>
                      <div className="rgb-inputs">
                        <div className="rgb-input-group">
                          <span>R</span>
                          <input
                            max={255} min={0}
                            onChange={(e) => handleRgbChange("r", e.target.value)}
                            type="number"
                            value={r}
                          />
                        </div>
                        <div className="rgb-input-group">
                          <span>G</span>
                          <input
                            max={255} min={0}
                            onChange={(e) => handleRgbChange("g", e.target.value)}
                            type="number"
                            value={g}
                          />
                        </div>
                        <div className="rgb-input-group">
                          <span>B</span>
                          <input
                            max={255} min={0}
                            onChange={(e) => handleRgbChange("b", e.target.value)}
                            type="number"
                            value={b}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

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

                    <label>
                      Event type
                      <select
                        onChange={(e) => setEventType(e.target.value as EventTypeId)}
                        value={eventType}
                      >
                        <option value="meeting">Meeting</option>
                        <option value="focus">Focus</option>
                        <option value="personal">Personal</option>
                        <option value="travel">Travel</option>
                        <option value="other">Other</option>
                      </select>
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
                            onChange={(e) => setRecurrenceInterval(Number(e.target.value))}
                            type="number"
                            value={recurrenceInterval}
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

            {initialEvent ? (
              <BacklinksList
                entityKey={eventKey(initialEvent.calendarId, initialEvent.id)}
              />
            ) : null}

            {submitError ? <p className="error-line">{submitError}</p> : null}
          </div>

          {/* ── Footer ── */}
          <div className="event-popout__footer">
            {initialEvent ? (
              <div style={{ display: "flex", gap: "6px" }}>
                <motion.button
                  className="danger-button"
                  onClick={() => void onDelete(initialEvent)}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  Delete
                </motion.button>
                {onConvertToDoc && (
                  <motion.button
                    className="ghost-button"
                    onClick={() => { onConvertToDoc(initialEvent); onClose(); }}
                    title="Open as milindDoc"
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <FileText size={13} />
                    Open as doc
                  </motion.button>
                )}
              </div>
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
