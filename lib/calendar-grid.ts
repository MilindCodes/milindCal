/**
 * Calendar geometry, with no DOM and no calendar library.
 *
 * This is the arithmetic FullCalendar was being carried for: which days a view
 * covers, where a time lands vertically, and — the only genuinely hard part —
 * how overlapping events share horizontal space.
 *
 * Everything here is pure so it can be tested without a browser, which is where
 * layout bugs actually hide. The React grid on top of it only turns these
 * numbers into elements.
 */

/* ── Days and ranges ──────────────────────────────────────────────── */

export const MS_MINUTE = 60_000;
export const MS_DAY = 86_400_000;

/** Midnight local time on the day containing `d`. */
export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * The seven days of the week containing `anchor`.
 *
 * `weekStart` is 0 for Sunday, 1 for Monday. Uses date arithmetic rather than
 * adding 24h in milliseconds, so a week spanning a DST change still returns
 * seven distinct calendar days.
 */
export function weekDays(anchor: Date, weekStart = 0): Date[] {
  const base = startOfDay(anchor);
  const shift = (base.getDay() - weekStart + 7) % 7;
  const first = addDays(base, -shift);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * The calendar month containing `anchor`, padded out to whole weeks.
 *
 * Always returns six rows. A month that fits in five would otherwise change
 * the grid's height as you page through the year, which makes every row jump.
 */
export function monthWeeks(anchor: Date, weekStart = 0): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const shift = (first.getDay() - weekStart + 7) % 7;
  const gridStart = addDays(startOfDay(first), -shift);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );
}

/* ── Vertical geometry ────────────────────────────────────────────── */

export interface TimeAxis {
  /** Minutes from midnight where the axis starts, e.g. 390 for 06:30. */
  minMinutes: number;
  /** Minutes from midnight where it ends, e.g. 1440 for 24:00. */
  maxMinutes: number;
  /** Minutes per slot line, e.g. 15. */
  slotMinutes: number;
}

export const DEFAULT_AXIS: TimeAxis = { minMinutes: 390, maxMinutes: 1440, slotMinutes: 15 };

/** "06:30:00" or "06:30" -> 390. */
export function parseTime(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutesInto(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** The slot boundaries an axis draws, as minutes from midnight. */
export function axisSlots(axis: TimeAxis = DEFAULT_AXIS): number[] {
  const out: number[] = [];
  for (let m = axis.minMinutes; m < axis.maxMinutes; m += axis.slotMinutes) out.push(m);
  return out;
}

/**
 * Where a moment sits on the axis, as a 0..1 fraction of its height.
 *
 * Clamped, so an event starting before the axis begins is drawn from the top
 * rather than off-screen — the axis starts at 06:30 by default and a 6am event
 * still has to be reachable.
 */
export function fractionOf(minutes: number, axis: TimeAxis = DEFAULT_AXIS): number {
  const span = axis.maxMinutes - axis.minMinutes;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (minutes - axis.minMinutes) / span));
}

/* ── Overlap layout ───────────────────────────────────────────────── */

export interface LaidOutInput {
  id: string;
  start: Date;
  end: Date;
}

export interface LaidOut<T extends LaidOutInput = LaidOutInput> {
  event: T;
  /** 0..1 fractions of the day column. */
  top: number;
  height: number;
  left: number;
  width: number;
  /** Column index and cluster width, exposed for styling and for tests. */
  column: number;
  columns: number;
}

/** Minimum visible height, as a fraction, so a 5-minute event is still clickable. */
const MIN_HEIGHT_FRACTION = 0.012;

/** Two events collide when they genuinely overlap; touching end-to-start does not. */
function collides(a: LaidOutInput, b: LaidOutInput): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Position a single day's events so overlapping ones share the width.
 *
 * The algorithm is the one Google Calendar uses, in three passes:
 *
 *   1. Split into clusters — maximal runs of events connected by overlap.
 *      Events in different clusters never interact, so each is solved alone.
 *   2. Within a cluster, give each event the leftmost column that no
 *      overlapping event already occupies.
 *   3. Expand each event rightward over empty columns until it meets one that
 *      overlaps it. Without this pass a lone event sitting beside a stack of
 *      three is drawn at a quarter width for no reason.
 *
 * Events are clipped to the axis, so something running 05:00–07:00 shows only
 * the part after the axis begins.
 */
export function layoutDay<T extends LaidOutInput>(
  events: readonly T[],
  axis: TimeAxis = DEFAULT_AXIS,
): LaidOut<T>[] {
  if (events.length === 0) return [];

  // Longest-first within a start time keeps big events on the left, which is
  // what makes a busy day readable rather than a staircase.
  const sorted = [...events].sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime()),
  );

  // 1. Clusters.
  const clusters: T[][] = [];
  let current: T[] = [];
  let clusterEnd = -Infinity;
  for (const ev of sorted) {
    if (current.length > 0 && ev.start.getTime() >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end.getTime());
  }
  if (current.length > 0) clusters.push(current);

  const out: LaidOut<T>[] = [];
  for (const cluster of clusters) {
    // 2. Columns.
    const columns: T[][] = [];
    const columnOf = new Map<string, number>();
    for (const ev of cluster) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (!columns[c].some((other) => collides(ev, other))) {
          columns[c].push(ev);
          columnOf.set(ev.id, c);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev]);
        columnOf.set(ev.id, columns.length - 1);
      }
    }

    const total = columns.length;
    for (const ev of cluster) {
      const col = columnOf.get(ev.id) ?? 0;

      // 3. Expand rightward while the next column is free for this event.
      let span = 1;
      for (let c = col + 1; c < total; c++) {
        if (columns[c].some((other) => collides(ev, other))) break;
        span++;
      }

      const startMin = minutesInto(ev.start);
      // An event ending at exactly midnight reads as 0 minutes, not 1440.
      const endsNextDay = ev.end.getTime() - ev.start.getTime() > 0 && !sameDay(ev.start, ev.end);
      const endMin = endsNextDay ? axis.maxMinutes : minutesInto(ev.end);

      const top = fractionOf(startMin, axis);
      const bottom = fractionOf(endMin, axis);
      out.push({
        event: ev,
        top,
        height: Math.max(MIN_HEIGHT_FRACTION, bottom - top),
        left: col / total,
        width: span / total,
        column: col,
        columns: total,
      });
    }
  }

  // Stable output order so React keys and snapshots don't churn.
  out.sort((a, b) => a.event.start.getTime() - b.event.start.getTime() || a.column - b.column);
  return out;
}

/**
 * Split events into the day columns of a view.
 *
 * An event is returned once per day it touches, clipped to that day, so a
 * meeting crossing midnight draws in both columns rather than overflowing one.
 * All-day events are not placed on the time axis and are filtered out here.
 */
export function bucketByDay<T extends LaidOutInput & { allDay?: boolean }>(
  events: readonly T[],
  days: readonly Date[],
): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  days.forEach((_, i) => buckets.set(i, []));

  for (const ev of events) {
    if (ev.allDay) continue;
    days.forEach((day, i) => {
      const dayStart = startOfDay(day);
      const dayEnd = addDays(dayStart, 1);
      if (ev.start.getTime() >= dayEnd.getTime() || ev.end.getTime() <= dayStart.getTime()) return;
      const clipped = {
        ...ev,
        start: ev.start.getTime() < dayStart.getTime() ? dayStart : ev.start,
        end: ev.end.getTime() > dayEnd.getTime() ? dayEnd : ev.end,
      } as T;
      buckets.get(i)!.push(clipped);
    });
  }
  return buckets;
}
