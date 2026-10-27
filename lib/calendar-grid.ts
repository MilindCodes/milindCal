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
 * The calendar days an event touches, each as local midnight.
 *
 * Two rules the year view's density tint got wrong:
 *
 *   An end at exactly midnight does not reach into that day. Google gives
 *   every all-day event an exclusive end, so counting `startOfDay(end)` lit up
 *   the day after every birthday, holiday and day off.
 *
 *   Step by calendar day, not by 24 hours. On a 25-hour fall-back day,
 *   midnight plus 24h is 23:00 the same day: a three-day event across that
 *   night counted its middle day twice and lost its last day entirely.
 */
export function daysCovered(start: Date, end: Date): Date[] {
  const lastInstant = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start;
  const last = startOfDay(lastInstant);
  const out: Date[] = [];
  for (let d = startOfDay(start); d.getTime() <= last.getTime(); d = addDays(d, 1)) out.push(d);
  return out;
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

/**
 * The wall-clock time `minutes` after midnight on `day`.
 *
 * Built from the date's fields rather than by adding minutes to startOfDay.
 * Where daylight saving begins *at* midnight — Chile, and historically Brazil,
 * Paraguay, Cuba and Iran — local 00:00 does not exist on the transition day,
 * so startOfDay rightly lands on 01:00. `setMinutes(600)` then keeps that hour
 * and adds ten more, giving 11:00: every create, move, resize, drop and slot
 * click on that day came out an hour late. The Date constructor resolves the
 * fields as written, and 1440 still rolls cleanly onto the next midnight.
 */
export function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
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
 * Whether an event has any part inside the axis.
 *
 * The axis does not start at midnight — it opens at 06:30 by default — so an
 * event can be clipped to a day and still fall entirely outside the visible
 * hours. Drawing those anyway is worse than useless: they clamp to the very
 * top, which puts a 2am event at the 06:30 line, and two events that never
 * overlapped in time end up stacked on the same pixel hiding each other.
 *
 * The grid uses this to keep them off the axis and show them as chips instead,
 * so they are neither lost nor drawn at a time they do not happen.
 */
export function intersectsAxis(ev: LaidOutInput, axis: TimeAxis = DEFAULT_AXIS): boolean {
  const startMin = minutesInto(ev.start);
  const endsNextDay = !sameDay(ev.start, ev.end) && ev.end.getTime() > ev.start.getTime();
  const endMin = endsNextDay ? axis.maxMinutes : minutesInto(ev.end);
  // Touching the boundary is not intersecting: an event ending exactly at
  // 06:30 has nothing to draw on a 06:30 axis.
  return endMin > axis.minMinutes && startMin < axis.maxMinutes;
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
  if (days.length === 0) return buckets;

  // Day bounds once, not once per event: this runs on every grid render
  // against every event the calendar holds, and rebuilt two Dates per event
  // per day to ask the same seven questions.
  const starts = days.map((day) => startOfDay(day));
  const ends = starts.map((start) => addDays(start, 1));
  const first = starts[0].getTime();
  const last = ends[ends.length - 1].getTime();

  for (const ev of events) {
    if (ev.allDay) continue;
    const s = ev.start.getTime();
    const e = ev.end.getTime();
    if (s >= last || e <= first) continue;
    for (let i = 0; i < days.length; i++) {
      const dayStart = starts[i];
      const dayEnd = ends[i];
      if (s >= dayEnd.getTime() || e <= dayStart.getTime()) continue;
      const clipped = {
        ...ev,
        start: s < dayStart.getTime() ? dayStart : ev.start,
        end: e > dayEnd.getTime() ? dayEnd : ev.end,
      } as T;
      buckets.get(i)!.push(clipped);
    }
  }
  return buckets;
}

/* ── Drag arithmetic ──────────────────────────────────────────────── */

export type DragKind = "create" | "move" | "resize";

export interface DragState {
  kind: DragKind;
  /** Present for move and resize; absent while creating. */
  eventId?: string;
  /** Day column and minute the gesture started in. */
  fromDay: number;
  fromMinutes: number;
  /** Where the pointer is now. */
  toDay: number;
  toMinutes: number;
  /** The dragged event's original span, so a move preserves its duration. */
  originStart?: Date;
  originEnd?: Date;
  /** True once the pointer has moved far enough to count as a drag. */
  moved: boolean;
}

export interface DragResult {
  start: Date;
  end: Date;
  dayIndex: number;
}

/**
 * Turn a drag into a concrete range.
 *
 * Kept here, away from React, because it is the part that can be wrong in ways
 * a screenshot will not show: a drag upward has to normalise, a move has to
 * keep its duration and respect where inside the tile it was grabbed, and a
 * resize must never invert the event.
 */
export function resolveDrag(
  drag: DragState,
  days: readonly Date[],
  axis: TimeAxis = DEFAULT_AXIS,
): DragResult | null {
  if (days.length === 0) return null;
  const snap = (m: number) => Math.round(m / axis.slotMinutes) * axis.slotMinutes;
  const clampDay = (i: number) => Math.min(days.length - 1, Math.max(0, i));
  const at = atMinutes;

  if (drag.kind === "create") {
    const a = snap(drag.fromMinutes);
    const b = snap(drag.toMinutes);
    const lo = Math.min(a, b);
    let hi = Math.max(a, b);
    // A drag too short to cross a slot boundary still has to make something
    // usable rather than a zero-length event.
    if (hi === lo) hi = lo + axis.slotMinutes;
    const day = clampDay(drag.fromDay);
    return { start: at(days[day], lo), end: at(days[day], hi), dayIndex: day };
  }

  if (drag.kind === "resize") {
    if (!drag.originStart) return null;
    const startMin = minutesInto(drag.originStart);
    // Never invert or collapse: the end stays at least one slot past the start.
    const endMin = Math.max(startMin + axis.slotMinutes, snap(drag.toMinutes));
    return {
      start: drag.originStart,
      end: at(drag.originStart, endMin),
      dayIndex: clampDay(drag.fromDay),
    };
  }

  if (!drag.originStart || !drag.originEnd) return null;
  const duration = drag.originEnd.getTime() - drag.originStart.getTime();
  // Where inside the tile the pointer grabbed it, so the event does not jump
  // its own top edge to the cursor on the first pixel of movement.
  const grabOffset = drag.fromMinutes - minutesInto(drag.originStart);
  const day = clampDay(drag.toDay);
  const start = at(days[day], snap(drag.toMinutes - grabOffset));
  return { start, end: new Date(start.getTime() + duration), dayIndex: day };
}

/* ── Month layout ─────────────────────────────────────────────────── */

export interface MonthSegment<T extends LaidOutInput = LaidOutInput> {
  event: T;
  /** Inclusive column range within the week, 0..6. */
  startCol: number;
  endCol: number;
  /** Which row inside the cell this bar occupies. */
  lane: number;
  /** The event began before this week, or runs past it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Lay one week of a month view out as spanning bars.
 *
 * A three-day event has to read as one bar crossing three cells, not as three
 * separate copies — that difference is most of what makes a month view
 * legible. Each week is solved independently, because a bar cannot cross the
 * end of a row anyway; an event spanning a week boundary becomes one segment
 * per week, flagged so the ends can be drawn open.
 *
 * Lanes are assigned greedily, longest first, so long events settle at the top
 * of the cell and short ones fill in beneath rather than pushing them around.
 */
export function layoutMonthWeek<T extends LaidOutInput>(
  events: readonly T[],
  week: readonly Date[],
): MonthSegment<T>[] {
  if (week.length === 0) return [];
  const weekStart = startOfDay(week[0]);
  const weekEnd = addDays(startOfDay(week[week.length - 1]), 1);
  // Hoisted for the same reason as in bucketByDay.
  const dayStarts = week.map((day) => startOfDay(day).getTime());
  const dayEnds = week.map((day) => addDays(startOfDay(day), 1).getTime());

  const spans: MonthSegment<T>[] = [];
  for (const ev of events) {
    if (ev.start.getTime() >= weekEnd.getTime() || ev.end.getTime() <= weekStart.getTime()) continue;
    let startCol = 0;
    let endCol = week.length - 1;
    for (let i = 0; i < week.length; i++) {
      const dayStart = dayStarts[i];
      const dayEnd = dayEnds[i];
      if (ev.start.getTime() >= dayStart && ev.start.getTime() < dayEnd) startCol = i;
      // An event ending exactly at midnight belongs to the previous day, not
      // to the one it touches for zero minutes.
      if (ev.end.getTime() > dayStart && ev.end.getTime() <= dayEnd) endCol = i;
    }
    if (ev.start.getTime() < weekStart.getTime()) startCol = 0;
    if (ev.end.getTime() > weekEnd.getTime()) endCol = week.length - 1;
    spans.push({
      event: ev,
      startCol,
      endCol: Math.max(startCol, endCol),
      lane: 0,
      continuesBefore: ev.start.getTime() < weekStart.getTime(),
      continuesAfter: ev.end.getTime() > weekEnd.getTime(),
    });
  }

  // Longest first so multi-day bars take the top lanes.
  spans.sort(
    (a, b) =>
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.startCol - b.startCol ||
      a.event.start.getTime() - b.event.start.getTime(),
  );

  const lanes: MonthSegment<T>[][] = [];
  for (const seg of spans) {
    let placed = false;
    for (let l = 0; l < lanes.length; l++) {
      const clash = lanes[l].some((o) => seg.startCol <= o.endCol && o.startCol <= seg.endCol);
      if (!clash) {
        seg.lane = l;
        lanes[l].push(seg);
        placed = true;
        break;
      }
    }
    if (!placed) {
      seg.lane = lanes.length;
      lanes.push([seg]);
    }
  }

  return spans.sort((a, b) => a.lane - b.lane || a.startCol - b.startCol);
}

/**
 * Trim a week's segments to a lane budget, reporting what was hidden per day.
 *
 * A month cell can only show so much before it stops being readable. Anything
 * past the budget is dropped and counted per column, so each day can offer a
 * "+N more" of its own rather than one count for the whole week.
 */
export function capMonthWeek<T extends LaidOutInput>(
  segments: readonly MonthSegment<T>[],
  maxLanes: number,
): { visible: MonthSegment<T>[]; hiddenPerDay: number[] } {
  const visible = segments.filter((s) => s.lane < maxLanes);
  const hiddenPerDay = Array.from({ length: 7 }, () => 0);
  for (const s of segments) {
    if (s.lane < maxLanes) continue;
    for (let c = s.startCol; c <= s.endCol; c++) hiddenPerDay[c] += 1;
  }
  return { visible, hiddenPerDay };
}

/* ── Pointer to slot ──────────────────────────────────────────────── */

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * Which day and time a point over the grid falls on.
 *
 * This is what lets a task dropped on Thursday afternoon land on Thursday
 * afternoon. Kept here, away from the DOM, so the arithmetic can be tested
 * directly — the caller measures one rect and passes it in.
 *
 * `gutter` is the width of the hour column on the left, which is not part of
 * any day. A point over it, or outside the rect, returns null rather than
 * guessing at the nearest day: dropping on the ruler is not a request to
 * schedule anything.
 */
export function pointToSlot(
  point: { x: number; y: number },
  rect: Rect,
  days: readonly Date[],
  axis: TimeAxis = DEFAULT_AXIS,
  options: { gutter?: number; snapMinutes?: number; durationMinutes?: number } = {},
): { start: Date; end: Date; dayIndex: number } | null {
  const { gutter = 0, snapMinutes = axis.slotMinutes, durationMinutes = 60 } = options;
  if (days.length === 0 || rect.width <= gutter || rect.height <= 0) return null;
  if (point.x < rect.left + gutter || point.x > rect.left + rect.width) return null;
  if (point.y < rect.top || point.y > rect.top + rect.height) return null;

  const columnWidth = (rect.width - gutter) / days.length;
  const dayIndex = Math.min(
    days.length - 1,
    Math.max(0, Math.floor((point.x - rect.left - gutter) / columnWidth)),
  );

  const fraction = (point.y - rect.top) / rect.height;
  const raw = axis.minMinutes + fraction * (axis.maxMinutes - axis.minMinutes);
  const snapped = Math.round(raw / snapMinutes) * snapMinutes;
  // Keep the whole event on the axis rather than starting it past the bottom.
  const startMinutes = Math.min(Math.max(snapped, axis.minMinutes), axis.maxMinutes - snapMinutes);

  const start = atMinutes(days[dayIndex], startMinutes);
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000), dayIndex };
}

/**
 * The same question for a month grid, where a point only identifies a day.
 *
 * Returns midnight on that day; the caller decides what time to give it, since
 * a month cell carries no hour.
 */
export function pointToDay(
  point: { x: number; y: number },
  rect: Rect,
  weeks: readonly (readonly Date[])[],
): Date | null {
  if (weeks.length === 0 || rect.width <= 0 || rect.height <= 0) return null;
  if (point.x < rect.left || point.x > rect.left + rect.width) return null;
  if (point.y < rect.top || point.y > rect.top + rect.height) return null;
  const row = Math.min(weeks.length - 1, Math.floor(((point.y - rect.top) / rect.height) * weeks.length));
  const cols = weeks[row].length;
  const col = Math.min(cols - 1, Math.floor(((point.x - rect.left) / rect.width) * cols));
  return startOfDay(weeks[row][col]);
}

/* ── Formatting ───────────────────────────────────────────────────── */

/* `toLocaleTimeString(undefined, options)` builds a fresh Intl.DateTimeFormat
 * on every call, and the grid made several per tile per render — an aria
 * label, a time chip, a drag preview. During a drag that is every frame. The
 * formatters are made once, lazily, so nothing locale-dependent runs on the
 * server. */
let LABEL_DAY_FMT: Intl.DateTimeFormat | null = null;
let CLOCK_FMT: Intl.DateTimeFormat | null = null;
let HOUR_FMT: Intl.DateTimeFormat | null = null;

const LABEL_DAY = {
  format: (d: Date) =>
    (LABEL_DAY_FMT ??= new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" })).format(d),
};

/** "9:05 AM" — what `toLocaleTimeString(undefined, { hour, minute: "2-digit" })` gave. */
export function clockTime(d: Date): string {
  return (CLOCK_FMT ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })).format(d);
}

/** "9 AM" on the hour and "9:30 AM" off it, the compact form a tile uses. */
export function compactTime(d: Date): string {
  if (d.getMinutes()) return clockTime(d);
  return (HOUR_FMT ??= new Intl.DateTimeFormat(undefined, { hour: "numeric" })).format(d);
}

/* ── Announcing an event ──────────────────────────────────────────── */

/**
 * How an event should be read aloud.
 *
 * A calendar's entire content is *when*. The event tiles are real buttons, so
 * they are reachable and openable from the keyboard already — but their
 * accessible name came from their visible text, which is the title and, if it
 * fits, a start time. A screen reader announced "Design review, button" and a
 * week of them sounded like an unordered list of nouns.
 *
 * Built from `toLocale*String` rather than a fixed format so it follows the
 * reader's own conventions, the same way every other date the app renders
 * does. Times are omitted for all-day events because there are none, and the
 * end date is named only when it differs from the start — "Tuesday to Tuesday"
 * is noise.
 */
export function eventLabel(ev: {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  done?: boolean;
}): string {
  const day = (d: Date) => LABEL_DAY.format(d);
  const time = (d: Date) => clockTime(d);

  const title = ev.title.trim() || "Untitled";
  const parts: string[] = [title];

  if (ev.allDay) {
    parts.push("all day");
    parts.push(sameDay(ev.start, ev.end) ? day(ev.start) : `${day(ev.start)} to ${day(ev.end)}`);
  } else if (sameDay(ev.start, ev.end)) {
    parts.push(`${time(ev.start)} to ${time(ev.end)}`);
    parts.push(day(ev.start));
  } else {
    // Crosses midnight: the end date matters as much as the end time.
    parts.push(`${day(ev.start)} ${time(ev.start)} to ${day(ev.end)} ${time(ev.end)}`);
  }

  if (ev.done) parts.push("completed");
  return parts.join(", ");
}

/* ── Keyboard ─────────────────────────────────────────────────────── */

/** One keyboard step: move by slots or days, or stretch the end by slots. */
export interface Nudge {
  slots?: number;
  days?: number;
  resizeSlots?: number;
}

/**
 * Where an event lands after a keyboard nudge — the keyboard's resolveDrag.
 *
 * Moving snaps to the slot grid on the way, so an event at 9:07 steps to 9:15
 * or 9:00 rather than to 9:22. It keeps its duration, as a drag does, and is
 * clamped so the whole event stays on the axis and inside the days on screen:
 * an arrow key at the edge does nothing rather than pushing the event out of
 * view. Stretching never collapses it below one slot. Times are built with
 * atMinutes, so a DST day lands where it should.
 *
 * Null when the event is not on any day shown.
 */
export function nudgeEvent(
  ev: { start: Date; end: Date },
  nudge: Nudge,
  days: readonly Date[],
  axis: TimeAxis = DEFAULT_AXIS,
): { start: Date; end: Date; dayIndex: number } | null {
  const from = days.findIndex((d) => sameDay(d, ev.start));
  if (from === -1) return null;
  const slot = axis.slotMinutes;
  const dayIndex = Math.min(days.length - 1, Math.max(0, from + (nudge.days ?? 0)));

  const startMinutes = minutesInto(ev.start);
  const duration = Math.max(slot, (ev.end.getTime() - ev.start.getTime()) / MS_MINUTE);
  const slots = nudge.slots ?? 0;
  let start = startMinutes;
  if (slots > 0) start = Math.floor(startMinutes / slot) * slot + slots * slot;
  else if (slots < 0) start = Math.ceil(startMinutes / slot) * slot + slots * slot;

  let length: number;
  if (nudge.resizeSlots) {
    // Stretching never moves the start. It stops one slot short of collapsing
    // and at the bottom of the axis.
    length = Math.max(slot, duration + nudge.resizeSlots * slot);
    length = Math.max(slot, Math.min(length, axis.maxMinutes - start));
  } else {
    // A move keeps its length and stops at either end of the axis.
    length = Math.min(duration, axis.maxMinutes - axis.minMinutes);
    start = Math.min(Math.max(start, axis.minMinutes), axis.maxMinutes - length);
  }

  const startAt = atMinutes(days[dayIndex], start);
  return { start: startAt, end: new Date(startAt.getTime() + length * MS_MINUTE), dayIndex };
}

/**
 * Where a keyboard-created event starts on `day`: the next slot after now if
 * that is today and still on the axis, else 9:00 — the time a person most
 * likely means when they ask for "an event on Thursday".
 */
export function keyboardSlotStart(day: Date, now: Date, axis: TimeAxis = DEFAULT_AXIS): Date {
  const slot = axis.slotMinutes;
  const nowMinutes = minutesInto(now);
  const next = Math.ceil(nowMinutes / slot) * slot;
  const minutes = sameDay(day, now) && next >= axis.minMinutes && next <= axis.maxMinutes - slot
    ? next
    : Math.min(Math.max(9 * 60, axis.minMinutes), axis.maxMinutes - slot);
  return atMinutes(day, minutes);
}
