/**
 * Tests for the calendar geometry that replaces FullCalendar's layout.
 *
 * The overlap algorithm is the part worth testing hardest: it is where a
 * calendar either reads clearly on a busy day or turns into a staircase.
 */

import {
  DEFAULT_AXIS,
  addDays,
  axisSlots,
  bucketByDay,
  fractionOf,
  intersectsAxis,
  layoutDay,
  monthWeeks,
  parseTime,
  sameDay,
  startOfDay,
  weekDays,
} from "../lib/calendar-grid.ts";

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("✓ " + name);
  } else {
    failed++;
    console.log("✗ " + name + (detail ? "  -> " + detail : ""));
  }
}

const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `got ${actual}, expected ${expected}`);

const close = (name, actual, expected, tol = 1e-9) =>
  check(name, Math.abs(actual - expected) < tol, `got ${actual}, expected ~${expected}`);

/** Build an event on a fixed day from "HH:MM" strings. */
const at = (id, from, to, day = "2026-03-10") => ({
  id,
  start: new Date(`${day}T${from}:00`),
  end: new Date(`${day}T${to}:00`),
});

/* ── Days and ranges ──────────────────────────────────────────────── */

{
  const days = weekDays(new Date("2026-03-11T13:00:00"), 0);
  eq("weekDays returns seven days", days.length, 7);
  eq("weekDays starts on Sunday when weekStart=0", days[0].getDay(), 0);
  eq("weekDays contains the anchor", days.some((d) => d.getDate() === 11), true);
  eq("weekDays starts at midnight", days[0].getHours(), 0);

  const mon = weekDays(new Date("2026-03-11T13:00:00"), 1);
  eq("weekDays honours a Monday start", mon[0].getDay(), 1);

  // A week containing a DST transition must still be seven distinct dates.
  const dst = weekDays(new Date("2026-03-10T12:00:00"), 0);
  const distinct = new Set(dst.map((d) => d.toDateString()));
  eq("a DST week still has seven distinct days", distinct.size, 7);
  eq("every day in a DST week is midnight local", dst.every((d) => d.getHours() === 0), true);
}

{
  const weeks = monthWeeks(new Date("2026-02-15T00:00:00"), 0);
  eq("monthWeeks returns six rows", weeks.length, 6);
  eq("monthWeeks rows are seven long", weeks.every((w) => w.length === 7), true);
  const flat = weeks.flat();
  eq(
    "monthWeeks covers the whole month",
    [...Array(28)].every((_, i) =>
      flat.some((d) => d.getMonth() === 1 && d.getDate() === i + 1),
    ),
    true,
  );
  // Six rows always, so paging the year never changes the grid's height.
  const may = monthWeeks(new Date("2026-05-01T00:00:00"), 0);
  eq("a short month still returns six rows", may.length, 6);
}

{
  eq("sameDay is true within a day", sameDay(new Date("2026-03-10T01:00"), new Date("2026-03-10T23:00")), true);
  eq("sameDay is false across days", sameDay(new Date("2026-03-10T23:59"), new Date("2026-03-11T00:01")), false);
  eq("addDays crosses a month boundary", addDays(new Date("2026-01-31T00:00"), 1).getMonth(), 1);
  eq("startOfDay zeroes the clock", startOfDay(new Date("2026-03-10T17:45:12")).getHours(), 0);
}

/* ── Vertical geometry ────────────────────────────────────────────── */

{
  eq("parseTime reads HH:MM:SS", parseTime("06:30:00"), 390);
  eq("parseTime reads HH:MM", parseTime("24:00"), 1440);
  close("fractionOf at the axis start is 0", fractionOf(390), 0);
  close("fractionOf at the axis end is 1", fractionOf(1440), 1);
  close("fractionOf is linear in between", fractionOf(915), 0.5);
  // Clamped: an event before the axis begins is drawn from the top, not
  // off-screen, so a 6am event on a 06:30 axis stays reachable.
  close("fractionOf clamps below the axis", fractionOf(0), 0);
  close("fractionOf clamps above the axis", fractionOf(2000), 1);

  const slots = axisSlots(DEFAULT_AXIS);
  eq("axisSlots covers the axis at slot resolution", slots.length, (1440 - 390) / 15);
  eq("axisSlots starts at the axis start", slots[0], 390);
  eq("axisSlots stops before the axis end", slots[slots.length - 1] < 1440, true);
}

/* ── Overlap layout ───────────────────────────────────────────────── */

{
  const solo = layoutDay([at("a", "09:00", "10:00")]);
  eq("a lone event takes one column", solo[0].columns, 1);
  close("a lone event takes the full width", solo[0].width, 1);
  close("a lone event starts at its own offset", solo[0].left, 0);
}

{
  // Touching end-to-start is not an overlap; back-to-back meetings should each
  // be full width, which is the single most common calendar shape there is.
  const abut = layoutDay([at("a", "09:00", "10:00"), at("b", "10:00", "11:00")]);
  eq("abutting events do not collide", abut.every((l) => l.columns === 1), true);
  eq("abutting events are both full width", abut.every((l) => Math.abs(l.width - 1) < 1e-9), true);
}

{
  const two = layoutDay([at("a", "09:00", "10:30"), at("b", "09:30", "11:00")]);
  eq("two overlapping events make two columns", two.every((l) => l.columns === 2), true);
  eq("two overlapping events each take half", two.every((l) => Math.abs(l.width - 0.5) < 1e-9), true);
  const lefts = two.map((l) => l.left).sort();
  close("the first sits at the left edge", lefts[0], 0);
  close("the second sits at the midpoint", lefts[1], 0.5);
}

{
  const three = layoutDay([
    at("a", "09:00", "12:00"),
    at("b", "09:30", "10:30"),
    at("c", "09:45", "11:00"),
  ]);
  eq("three mutually overlapping events make three columns", three.every((l) => l.columns === 3), true);
  const ids = three.map((l) => l.event.id);
  eq("every event is laid out exactly once", new Set(ids).size, 3);
  eq("no two share a column while overlapping", new Set(three.map((l) => l.column)).size, 3);
}

{
  // The expansion pass: a short event beside a stack should widen into the
  // space nothing else is using, instead of being pinned to a narrow sliver.
  const expand = layoutDay([
    at("a", "09:00", "10:00"),
    at("b", "09:15", "09:45"),
    at("c", "11:00", "12:00"),
  ]);
  const c = expand.find((l) => l.event.id === "c");
  close("an event in its own cluster is full width", c.width, 1);
  eq("a separate cluster is solved independently", c.columns, 1);

  const wide = layoutDay([
    at("a", "09:00", "09:30"),
    at("b", "09:00", "11:00"),
    at("c", "09:45", "10:15"),
  ]);
  const a = wide.find((l) => l.event.id === "a");
  // "a" ends before "c" starts, so the column "c" occupies is free to "a".
  eq("an event expands over columns it does not collide with", a.width > 0.5 - 1e-9, true);
}

{
  const clipped = layoutDay([at("a", "05:00", "07:00")]);
  close("an event starting before the axis is clipped to the top", clipped[0].top, 0);
  eq("a clipped event keeps positive height", clipped[0].height > 0, true);

  const tiny = layoutDay([at("a", "09:00", "09:01")]);
  eq("a one-minute event keeps a clickable minimum height", tiny[0].height >= 0.012, true);
}

/* ── Axis intersection ────────────────────────────────────────────── */

{
  // The axis opens at 06:30, so "inside the day" and "inside the axis" are
  // different questions. Getting this wrong stacks unrelated events on the
  // same pixel at the top of the column.
  eq("an event inside the axis intersects it", intersectsAxis(at("a", "09:00", "10:00")), true);
  eq("an event entirely before the axis does not", intersectsAxis(at("b", "00:00", "02:00")), false);
  eq("an event ending exactly at the axis start does not", intersectsAxis(at("c", "05:00", "06:30")), false);
  eq("an event straddling the axis start does", intersectsAxis(at("d", "05:00", "07:30")), true);
  eq("an event ending one minute after the axis start does", intersectsAxis(at("e", "05:00", "06:31")), true);
  eq("an event at the very end of the axis does", intersectsAxis(at("f", "23:00", "23:59")), true);

  // Two events that never overlap in time must not both be placed on the axis
  // when one of them falls entirely outside it — that was the visual collision.
  const day = [at("early", "00:00", "02:00"), at("flight", "05:00", "07:30")];
  const onAxis = day.filter((e) => intersectsAxis(e));
  eq("only the event touching the axis is laid out", onAxis.length, 1);
  eq("and it is the right one", onAxis[0].id, "flight");
}

/* ── Bucketing across days ────────────────────────────────────────── */

{
  const days = weekDays(new Date("2026-03-10T00:00:00"), 0);
  const overnight = {
    id: "n",
    start: new Date("2026-03-10T22:00:00"),
    end: new Date("2026-03-11T02:00:00"),
  };
  const buckets = bucketByDay([overnight], days);
  const touched = [...buckets.entries()].filter(([, list]) => list.length > 0);
  eq("an overnight event appears on two days", touched.length, 2);
  const [firstIdx, firstList] = touched[0];
  eq(
    "the first day's copy is clipped to midnight",
    firstList[0].end.getTime() === startOfDay(addDays(days[firstIdx], 1)).getTime(),
    true,
  );
  const secondList = touched[1][1];
  eq("the second day's copy starts at midnight", secondList[0].start.getHours(), 0);

  const allDay = bucketByDay(
    [{ id: "x", start: days[2], end: addDays(days[2], 1), allDay: true }],
    days,
  );
  eq(
    "all-day events are kept off the time axis",
    [...allDay.values()].every((l) => l.length === 0),
    true,
  );

  eq("an empty day yields an empty bucket", bucketByDay([], days).get(0).length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
