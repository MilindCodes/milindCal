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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_AXIS,
  addDays,
  bucketByDay,
  fractionOf,
  intersectsAxis,
  layoutDay,
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
  nowIndicator?: boolean;
}

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
  nowIndicator = true,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  // The indicator only needs minute resolution; ticking faster would re-render
  // the whole grid for a line that has not visibly moved.
  useEffect(() => {
    if (!nowIndicator) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [nowIndicator]);

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
  const allDay = useMemo(() => {
    const rows = days.map(() => [] as GridEvent[]);
    for (const ev of events) {
      if (!ev.allDay) continue;
      days.forEach((day, i) => {
        if (ev.start.getTime() < addDays(startOfDay(day), 1).getTime() &&
            ev.end.getTime() > startOfDay(day).getTime()) rows[i].push(ev);
      });
    }
    return rows;
  }, [events, days]);

  // All-day events and off-axis ones share the same strip. Off-axis chips keep
  // their clock time so they read as "happens, just not on this axis".
  const strip = useMemo(
    () => days.map((_, i) => [...allDay[i], ...offAxis[i]]),
    [days, allDay, offAxis],
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

  const todayIndex = days.findIndex((d) => sameDay(d, now));
  const nowFraction = fractionOf(minutesInto(now), axis);
  const nowVisible =
    nowIndicator &&
    todayIndex >= 0 &&
    minutesInto(now) >= axis.minMinutes &&
    minutesInto(now) <= axis.maxMinutes;

  const columns = `var(--tg-gutter) repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="tg">
      <div className="tg__head" style={{ gridTemplateColumns: columns }}>
        <div className="tg__corner" />
        {days.map((day) => (
          <div
            className={`tg__dayhead${sameDay(day, now) ? " is-today" : ""}`}
            key={day.toISOString()}
          >
            <span className="tg__dayname">
              {day.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
            </span>
            <span className="tg__daynum">{day.getDate()}</span>
          </div>
        ))}
      </div>

      {strip.some((row) => row.length > 0) ? (
        <div className="tg__allday" style={{ gridTemplateColumns: columns }}>
          <div className="tg__allday-label">all-day</div>
          {strip.map((row, i) => (
            <div className="tg__allday-cell" key={days[i].toISOString()}>
              {row.map((ev) => (
                <button
                  className="tg__chip"
                  key={ev.id}
                  onClick={() => onEventClick?.(ev)}
                  style={{ ["--accent" as string]: ev.accent ?? "var(--cherry)" }}
                  type="button"
                >
                  {ev.allDay ? null : (
                    <span className="tg__chip-time">
                      {ev.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                  {ev.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="tg__scroll" ref={scrollRef}>
        <div className="tg__body" style={{ gridTemplateColumns: columns }}>
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
              className={`tg__col${sameDay(day, now) ? " is-today" : ""}`}
              key={day.toISOString()}
              onClick={(e) => {
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
                  className={`tg__event${slot.event.done ? " is-done" : ""}`}
                  key={slot.event.id}
                  onClick={() => onEventClick?.(slot.event)}
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
                </button>
              ))}

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
