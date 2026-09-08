"use client";

/**
 * The day and week time grid.
 *
 * This is milindCal's own markup, not a theme applied over someone else's.
 * Layout arithmetic lives in lib/calendar-grid and is tested without a DOM;
 * this file only turns those numbers into elements.
 *
 * Two decisions worth knowing about:
 *
 * Slot lines are painted with a repeating gradient rather than 70 divs per
 * column. At seven columns that is 490 elements saved on every render, and the
 * lines are decoration — nothing needs to hit-test them.
 *
 * Events are positioned in percentages, so the grid reflows on resize with no
 * JavaScript and no measurement pass.
 */

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useGridDrag } from "./use-grid-drag";
import { useNow } from "./use-now";
import {
  DEFAULT_AXIS,
  eventLabel,
  layoutMonthWeek,
  bucketByDay,
  fractionOf,
  intersectsAxis,
  layoutDay,
  resolveDrag,
  minutesInto,
  sameDay,
  startOfDay,
  type LaidOutInput,
  type TimeAxis,
} from "@/lib/calendar-grid";

export interface GridEvent extends LaidOutInput {
  title: string;
  allDay?: boolean;
  accent?: string;
  done?: boolean;
}

interface TimeGridProps {
  days: Date[];
  events: readonly GridEvent[];
  axis?: TimeAxis;
  /** Render the inside of an event tile; falls back to its title. */
  renderEvent?: (event: GridEvent) => ReactNode;
  onEventClick?: (event: GridEvent) => void;
  /** Clicking an empty slot, rounded down to the slot the pointer is in. */
  onSlotClick?: (start: Date) => void;
  /** A tile was dragged or resized to a new range. */
  onEventChange?: (id: string, start: Date, end: Date) => void;
  /** An empty range was dragged out. */
  onCreate?: (start: Date, end: Date) => void;
  nowIndicator?: boolean;
}

/** How long after a drag a click is treated as that drag's own click. */
const CLICK_AFTER_DRAG_MS = 300;

/** Hour labels only: a label every 15 minutes is noise. */
function hourLines(axis: TimeAxis): number[] {
  const out: number[] = [];
  const firstHour = Math.ceil(axis.minMinutes / 60) * 60;
  for (let m = firstHour; m < axis.maxMinutes; m += 60) out.push(m);
  return out;
}

function formatHour(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

export function TimeGrid({
  days,
  events,
  axis = DEFAULT_AXIS,
  renderEvent,
  onEventClick,
  onSlotClick,
  onEventChange,
  onCreate,
  nowIndicator = true,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /* A drag ends with a pointerup, and the browser follows that with a click,
   * which must not also read as "opened this tile" or "clicked this slot".
   *
   * A boolean latch is wrong here: a drag that ends outside the element fires
   * no click at all, so the latch stays armed and eats the next real click
   * somewhere else — drag one event, then click another, and nothing happens.
   * A timestamp cannot get stuck: it only suppresses the click that genuinely
   * follows a drag, and heals itself a moment later. */
  const lastDragEnd = useRef(0);
  /* Null until mounted — see use-now.ts. Everything below that depends on the
   * clock has to tolerate not having one yet. */
  const now = useNow(nowIndicator);

  const buckets = useMemo(() => bucketByDay(events, days), [events, days]);

  /* Only events with time inside the axis are placed on it. The rest would
   * clamp to the top — putting a 2am event on the 06:30 line, and stacking
   * events that never overlapped on the same pixel. They become chips instead. */
  const laidOut = useMemo(
    () =>
      days.map((_, i) =>
        layoutDay((buckets.get(i) ?? []).filter((ev) => intersectsAxis(ev, axis)), axis),
      ),
    [days, buckets, axis],
  );
  const offAxis = useMemo(
    () => days.map((_, i) => (buckets.get(i) ?? []).filter((ev) => !intersectsAxis(ev, axis))),
    [days, buckets, axis],
  );
  const allDayEvents = useMemo(() => events.filter((ev) => ev.allDay), [events]);

  /* All-day events and off-axis ones share the same strip, laid out as
   * spanning bars rather than one chip per day.
   *
   * A Tuesday-to-Friday conference used to render as three identical chips,
   * which is the single clearest tell that a grid is drawing days rather than
   * events. `layoutMonthWeek` already solves exactly this — a week of spanning
   * bars with lanes — and is tested without a DOM, so the strip is just a
   * one-row month week. Off-axis events arrive already clipped to a single day
   * by `bucketByDay`, so they fall out as one-column segments for free, and
   * keep their clock time so they read as "happens, just not on this axis". */
  const stripSegments = useMemo(
    () => layoutMonthWeek([...allDayEvents, ...days.flatMap((_, i) => offAxis[i])], days),
    [allDayEvents, offAxis, days],
  );
  const stripLanes = useMemo(
    () => stripSegments.reduce((max, seg) => Math.max(max, seg.lane + 1), 0),
    [stripSegments],
  );

  const hours = useMemo(() => hourLines(axis), [axis]);
  const slotPercent = (axis.slotMinutes / (axis.maxMinutes - axis.minMinutes)) * 100;
  const hourPercent = (60 / (axis.maxMinutes - axis.minMinutes)) * 100;

  // Open on the working day rather than at the axis start, so a 6:30 grid does
  // not spend its first screen on hours nobody uses.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = fractionOf(9 * 60, axis) * el.scrollHeight;
    el.scrollTop = Math.max(0, target - el.clientHeight * 0.25);
    // Only on mount: re-running would yank the user back after every paging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayIndex = now ? days.findIndex((d) => sameDay(d, now)) : -1;
  const nowMinutes = now ? minutesInto(now) : 0;
  const nowFraction = fractionOf(nowMinutes, axis);
  const nowVisible =
    nowIndicator &&
    now !== null &&
    todayIndex >= 0 &&
    nowMinutes >= axis.minMinutes &&
    nowMinutes <= axis.maxMinutes;

  const handleCommit = useCallback(
    (kind: "create" | "move" | "resize", result: { start: Date; end: Date }, id?: string) => {
      lastDragEnd.current = Date.now();
      if (kind === "create") onCreate?.(result.start, result.end);
      else if (id) onEventChange?.(id, result.start, result.end);
    },
    [onCreate, onEventChange],
  );

  const { bodyRef, drag, begin } = useGridDrag({ days, axis, onCommit: handleCommit });

  // What the drag currently describes, drawn as a preview so the gesture shows
  // its result before it is committed.
  const preview = useMemo(() => {
    if (!drag || !drag.moved) return null;
    const r = resolveDrag(drag, days, axis);
    if (!r) return null;
    return {
      dayIndex: r.dayIndex,
      top: fractionOf(minutesInto(r.start), axis),
      height: Math.max(
        0.012,
        fractionOf(minutesInto(r.end) || axis.maxMinutes, axis) - fractionOf(minutesInto(r.start), axis),
      ),
      label: r.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
  }, [drag, days, axis]);

  const columns = `var(--tg-gutter) repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="tg">
      <div className="tg__head" style={{ gridTemplateColumns: columns }}>
        <div className="tg__corner" />
        {days.map((day) => (
          <div
            className={`tg__dayhead${now && sameDay(day, now) ? " is-today" : ""}`}
            key={day.toISOString()}
          >
            <span className="tg__dayname">
              {day.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
            </span>
            <span className="tg__daynum">{day.getDate()}</span>
          </div>
        ))}
      </div>

      {stripSegments.length > 0 ? (
        <div className="tg__allday" style={{ gridTemplateColumns: columns }}>
          <div className="tg__allday-label">all-day</div>
          {/* One positioning context for the whole week, so a bar can cross
            * several days. The day separators are painted onto it rather than
            * drawn as cell borders, the same way the hour lines are. */}
          <div
            className="tg__allday-track"
            style={{
              ["--tg-allday-lanes" as string]: stripLanes,
              backgroundImage:
                `repeating-linear-gradient(to right, var(--tg-hour-line) 0 1px,` +
                ` transparent 1px ${100 / days.length}%)`,
            }}
          >
            {stripSegments.map((seg) => (
              <button
                aria-label={eventLabel(seg.event)}
                className={
                  "tg__chip" +
                  (seg.event.done ? " is-done" : "") +
                  (seg.continuesBefore ? " continues-before" : "") +
                  (seg.continuesAfter ? " continues-after" : "")
                }
                key={seg.event.id + ":" + seg.startCol}
                onClick={() => onEventClick?.(seg.event)}
                style={{
                  left: `calc(${(seg.startCol / days.length) * 100}% + 3px)`,
                  width: `calc(${((seg.endCol - seg.startCol + 1) / days.length) * 100}% - 6px)`,
                  top: `calc(${seg.lane} * var(--tg-allday-lane))`,
                  ["--accent" as string]: seg.event.accent ?? "var(--cherry)",
                }}
                type="button"
              >
                {/* A cut bar continuing from the previous week already showed
                  * its time where it started; repeating it reads as a second
                  * event. */}
                {!seg.event.allDay && !seg.continuesBefore ? (
                  <span className="tg__chip-time">
                    {seg.event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                ) : null}
                {seg.event.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="tg__scroll" ref={scrollRef}>
        <div className="tg__body" ref={bodyRef} style={{ gridTemplateColumns: columns }}>
          <div className="tg__gutter">
            {hours.map((m) => (
              <span
                className="tg__hour"
                key={m}
                style={{ top: `${fractionOf(m, axis) * 100}%` }}
              >
                {formatHour(m)}
              </span>
            ))}
          </div>

          {days.map((day, i) => (
            <div
              className={`tg__col${now && sameDay(day, now) ? " is-today" : ""}`}
              key={day.toISOString()}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return; // started on a tile
                begin(e, "create", i);
              }}
              onClick={(e) => {
                if (Date.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS) return;
                if (!onSlotClick || e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const frac = (e.clientY - rect.top) / rect.height;
                const mins =
                  axis.minMinutes + frac * (axis.maxMinutes - axis.minMinutes);
                const snapped = Math.floor(mins / axis.slotMinutes) * axis.slotMinutes;
                const start = startOfDay(day);
                start.setMinutes(snapped);
                onSlotClick(start);
              }}
              style={{
                backgroundImage:
                  `repeating-linear-gradient(to bottom,` +
                  ` var(--tg-slot-line) 0 1px, transparent 1px ${slotPercent}%),` +
                  `repeating-linear-gradient(to bottom,` +
                  ` var(--tg-hour-line) 0 1px, transparent 1px ${hourPercent}%)`,
              }}
            >
              {laidOut[i].map((slot) => (
                <button
                  aria-label={eventLabel(slot.event)}
                  className={
                    "tg__event" +
                    (slot.event.done ? " is-done" : "") +
                    (drag?.moved && drag.eventId === slot.event.id ? " is-dragging" : "")
                  }
                  key={slot.event.id}
                  onClick={() => {
                    if (Date.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS) return;
                    onEventClick?.(slot.event);
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    begin(e, "move", i, slot.event);
                  }}
                  style={{
                    top: `${slot.top * 100}%`,
                    height: `${slot.height * 100}%`,
                    left: `calc(${slot.left * 100}% + 1px)`,
                    width: `calc(${slot.width * 100}% - 3px)`,
                    ["--accent" as string]: slot.event.accent ?? "var(--cherry)",
                  }}
                  type="button"
                >
                  {renderEvent ? renderEvent(slot.event) : (
                    <span className="tg__event-title">{slot.event.title}</span>
                  )}
                  {/* Resize grip. A span rather than a button: it is a drag
                    * target only, and a second tab stop per event would make
                    * the grid impossible to tab past. */}
                  <span
                    className="tg__resize"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      begin(e, "resize", i, slot.event);
                    }}
                  />
                </button>
              ))}

              {preview && preview.dayIndex === i ? (
                <div
                  className="tg__preview"
                  style={{ top: `${preview.top * 100}%`, height: `${preview.height * 100}%` }}
                >
                  <span className="tg__preview-time">{preview.label}</span>
                </div>
              ) : null}

              {nowVisible && i === todayIndex ? (
                <div className="tg__now" style={{ top: `${nowFraction * 100}%` }} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
