"use client";

/**
 * The month view.
 *
 * Multi-day events are drawn as single bars spanning their cells rather than
 * repeated once per day — that difference is most of what makes a month grid
 * readable. Lane assignment and clipping live in lib/calendar-grid and are
 * tested without a DOM; this file positions the result.
 *
 * Each week is its own positioning context, because a bar cannot cross the end
 * of a row anyway. An event spanning a week boundary becomes one segment per
 * week, with its cut end drawn open so it reads as continuing.
 */

import { useMemo, type ReactNode } from "react";
import {
  capMonthWeek,
  layoutMonthWeek,
  monthWeeks,
  sameDay,
  startOfDay,
  type LaidOutInput,
} from "@/lib/calendar-grid";

export interface MonthEvent extends LaidOutInput {
  title: string;
  allDay?: boolean;
  accent?: string;
  done?: boolean;
}

interface MonthGridProps {
  /** Any date inside the month to show. */
  anchor: Date;
  events: readonly MonthEvent[];
  weekStart?: 0 | 1;
  /** Bars per cell before the rest collapse into "+N more". */
  maxLanes?: number;
  onEventClick?: (event: MonthEvent) => void;
  onDayClick?: (day: Date) => void;
  /** The "+N more" affordance was used on this day. */
  onMoreClick?: (day: Date, hidden: number) => void;
  renderEvent?: (event: MonthEvent) => ReactNode;
}

const WEEKDAY_LABELS = (weekStart: 0 | 1) =>
  Array.from({ length: 7 }, (_, i) => {
    // 2026-03-08 is a Sunday, so it is a convenient origin for names.
    const d = new Date(2026, 2, 8 + ((i + weekStart) % 7));
    return d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  });

export function MonthGrid({
  anchor,
  events,
  weekStart = 0,
  maxLanes = 3,
  onEventClick,
  onDayClick,
  onMoreClick,
  renderEvent,
}: MonthGridProps) {
  const weeks = useMemo(() => monthWeeks(anchor, weekStart), [anchor, weekStart]);
  const labels = useMemo(() => WEEKDAY_LABELS(weekStart), [weekStart]);
  const month = anchor.getMonth();
  const today = new Date();

  const rows = useMemo(
    () =>
      weeks.map((week) => {
        const segments = layoutMonthWeek(events, week);
        return { week, ...capMonthWeek(segments, maxLanes) };
      }),
    [weeks, events, maxLanes],
  );

  return (
    <div className="mg">
      <div className="mg__head">
        {labels.map((label) => (
          <div className="mg__weekday" key={label}>
            {label}
          </div>
        ))}
      </div>

      <div className="mg__body">
        {rows.map(({ week, visible, hiddenPerDay }) => (
          <div className="mg__week" key={week[0].toISOString()}>
            <div className="mg__cells">
              {week.map((day, col) => (
                <div
                  className={
                    "mg__cell" +
                    (day.getMonth() === month ? "" : " is-outside") +
                    (sameDay(day, today) ? " is-today" : "")
                  }
                  key={day.toISOString()}
                  onClick={() => onDayClick?.(day)}
                  role="presentation"
                >
                  <span className="mg__daynum">{day.getDate()}</span>
                  {hiddenPerDay[col] > 0 ? (
                    <button
                      className="mg__more"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoreClick?.(day, hiddenPerDay[col]);
                      }}
                      type="button"
                    >
                      +{hiddenPerDay[col]} more
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Bars float above the cells so one can cross several of them. */}
            <div className="mg__bars">
              {visible.map((seg) => (
                <button
                  className={
                    "mg__bar" +
                    (seg.event.done ? " is-done" : "") +
                    (seg.continuesBefore ? " continues-before" : "") +
                    (seg.continuesAfter ? " continues-after" : "")
                  }
                  key={seg.event.id + ":" + seg.startCol}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEventClick?.(seg.event);
                  }}
                  style={{
                    left: `calc(${(seg.startCol / 7) * 100}% + 3px)`,
                    width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - 6px)`,
                    top: `calc(var(--mg-daynum-h) + ${seg.lane} * var(--mg-lane-h))`,
                    ["--accent" as string]: seg.event.accent ?? "var(--cherry)",
                  }}
                  type="button"
                >
                  {renderEvent ? renderEvent(seg.event) : (
                    <>
                      {!seg.event.allDay && !seg.continuesBefore ? (
                        <span className="mg__bar-time">
                          {seg.event.start.toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: seg.event.start.getMinutes() ? "2-digit" : undefined,
                          })}
                        </span>
                      ) : null}
                      <span className="mg__bar-title">{seg.event.title}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The year view: twelve months at a glance.
 *
 * Deliberately not a shrunken month grid. At this size event titles are
 * unreadable, so each day carries a density dot instead — the question a year
 * view answers is "when was I busy", not "what was it called".
 */
export function YearGrid({
  year,
  events,
  weekStart = 0,
  onDayClick,
}: {
  year: number;
  events: readonly MonthEvent[];
  weekStart?: 0 | 1;
  onDayClick?: (day: Date) => void;
}) {
  const today = new Date();

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      const last = startOfDay(ev.end);
      for (let d = startOfDay(ev.start); d <= last; d = new Date(d.getTime() + 86_400_000)) {
        const key = d.toDateString();
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [events]);

  return (
    <div className="yg">
      {Array.from({ length: 12 }, (_, m) => {
        const weeks = monthWeeks(new Date(year, m, 1), weekStart);
        return (
          <div className="yg__month" key={m}>
            <div className="yg__name">
              {new Date(year, m, 1).toLocaleDateString(undefined, { month: "long" })}
            </div>
            <div className="yg__grid">
              {weeks.flat().map((day) => {
                const inMonth = day.getMonth() === m;
                const n = inMonth ? counts.get(day.toDateString()) ?? 0 : 0;
                return (
                  <button
                    className={
                      "yg__day" +
                      (inMonth ? "" : " is-outside") +
                      (sameDay(day, today) ? " is-today" : "") +
                      (n > 0 ? " has-events" : "")
                    }
                    disabled={!inMonth}
                    key={day.toISOString()}
                    onClick={() => onDayClick?.(day)}
                    style={{ ["--density" as string]: Math.min(1, n / 4) }}
                    type="button"
                  >
                    {inMonth ? day.getDate() : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
