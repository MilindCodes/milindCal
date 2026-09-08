/**
 * Tests for the exact date strings milindCal has to emit.
 *
 * Everything here is timezone-sensitive, and every bug these pin down was
 * invisible from a machine set to UTC — which is why each block runs the same
 * assertions from Kiritimati (UTC+14) through Baker Island (UTC-12). Node
 * re-reads `process.env.TZ` on the next Date call, so switching zones mid-run
 * is enough; no subprocesses needed.
 */

import {
  allDayEndToExclusive,
  allDayEndToInclusive,
  toDateOnly,
  toDateTimeLocal,
  toUtcRruleDate,
} from "../lib/datetime.ts";

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log("✓ " + name); }
  else { failed++; console.log("✗ " + name + (detail ? "  -> " + detail : "")); }
};
const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/** The spread that matters: both extremes of the offset range, and UTC itself. */
const ZONES = [
  "UTC",
  "Pacific/Kiritimati",   // UTC+14, the furthest ahead there is
  "Asia/Kolkata",         // UTC+5:30, a half-hour offset
  "America/Los_Angeles",  // UTC-7/-8, and it observes DST
  "Etc/GMT+12",           // UTC-12, the furthest behind
];

const inZone = (tz, fn) => { process.env.TZ = tz; fn(); };

/* ── RRULE UNTIL is a UTC instant ─────────────────────────────────── */

/**
 * The `Z` suffix is a promise. date-fns `format` read local clock parts and
 * appended `Z` anyway, so the string said UTC and meant something else.
 */
{
  for (const tz of ZONES) {
    inZone(tz, () => {
      eq(`UNTIL is a genuine UTC instant in ${tz}`, toUtcRruleDate("2026-09-08"), "20260908T235959Z");
    });
  }

  // The editor reads UNTIL back by slicing the first eight characters, so the
  // date the user picked has to survive a round trip. It did not: in Kolkata
  // the emitted value began "20260909", moving the end date a day every open.
  for (const tz of ZONES) {
    inZone(tz, () => {
      const emitted = toUtcRruleDate("2026-09-08");
      const readBack = `${emitted.slice(0, 4)}-${emitted.slice(4, 6)}-${emitted.slice(6, 8)}`;
      eq(`UNTIL round-trips unchanged in ${tz}`, readBack, "2026-09-08");
    });
  }

  inZone("Asia/Kolkata", () => {
    check("the shape is RRULE basic format", /^\d{8}T\d{6}Z$/.test(toUtcRruleDate("2026-01-01")));
    eq("a year boundary does not roll over", toUtcRruleDate("2026-12-31"), "20261231T235959Z");
    eq("a leap day is preserved", toUtcRruleDate("2028-02-29"), "20280229T235959Z");
  });
}

/* ── All-day dates stay on the day the user chose ─────────────────── */

/**
 * Google returns a bare `YYYY-MM-DD` for every all-day event. `new Date()`
 * reads that as UTC midnight, which is the previous day everywhere west of
 * Greenwich — so the naive parse shows the wrong date for half the planet.
 */
{
  for (const tz of ZONES) {
    inZone(tz, () => {
      eq(`a bare date reads as itself in ${tz}`, toDateOnly("2026-09-08"), "2026-09-08");
    });
  }

  inZone("America/Los_Angeles", () => {
    eq("an empty value stays empty", toDateOnly(""), "");
    eq("an empty value stays empty for datetime too", toDateTimeLocal(""), "");
    // A zoned instant is converted to the viewer's wall clock, which is the point.
    eq("a zoned instant becomes local wall time",
       toDateTimeLocal("2026-09-08T23:30:00.000Z"), "2026-09-08T16:30");
    eq("and its local date can differ from its UTC date",
       toDateOnly("2026-09-09T04:00:00.000Z"), "2026-09-08");
  });

  inZone("Pacific/Kiritimati", () => {
    eq("east of UTC the local date can run ahead",
       toDateOnly("2026-09-08T20:00:00.000Z"), "2026-09-09");
  });

  inZone("UTC", () => {
    eq("an unzoned datetime is left on its own clock",
       toDateTimeLocal("2026-09-08T09:05:00"), "2026-09-08T09:05");
    eq("minutes are zero-padded", toDateTimeLocal("2026-09-08T09:05:00"), "2026-09-08T09:05");
    eq("midnight is not blank", toDateTimeLocal("2026-09-08T00:00:00"), "2026-09-08T00:00");
  });
}

/* ── The all-day end date is exclusive on the wire, inclusive on screen ── */

{
  for (const tz of ZONES) {
    inZone(tz, () => {
      eq(`inclusive end steps back one day in ${tz}`, allDayEndToInclusive("2026-09-09"), "2026-09-08");
      eq(`exclusive end steps forward one day in ${tz}`, allDayEndToExclusive("2026-09-08"), "2026-09-09");
    });
  }

  inZone("America/Los_Angeles", () => {
    eq("the two are inverses", allDayEndToInclusive(allDayEndToExclusive("2026-09-08")), "2026-09-08");
    eq("a month boundary rolls back correctly", allDayEndToInclusive("2026-10-01"), "2026-09-30");
    eq("a month boundary rolls forward correctly", allDayEndToExclusive("2026-09-30"), "2026-10-01");
    eq("a year boundary rolls back correctly", allDayEndToInclusive("2027-01-01"), "2026-12-31");
    eq("a year boundary rolls forward correctly", allDayEndToExclusive("2026-12-31"), "2027-01-01");
    eq("a leap day is reachable", allDayEndToExclusive("2028-02-28"), "2028-02-29");
    eq("and passable", allDayEndToExclusive("2028-02-29"), "2028-03-01");
    eq("a non-leap February ends at 28", allDayEndToExclusive("2027-02-28"), "2027-03-01");
  });

  // Day arithmetic must not go through local midnight: there are zones where a
  // given local midnight does not exist, because DST springs forward at 00:00.
  inZone("America/Santiago", () => {
    eq("a DST-at-midnight transition still steps one calendar day",
       allDayEndToExclusive("2026-09-05"), "2026-09-06");
    eq("and steps back one calendar day",
       allDayEndToInclusive("2026-09-06"), "2026-09-05");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
