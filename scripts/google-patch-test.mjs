/**
 * Tests for what a PATCH sends to Google.
 *
 * `events.patch` treats every key in the body as an instruction, so the only
 * safe way to leave a field alone is to leave it out. These pin both halves of
 * that: a partial update carries nothing it was not given, and a full payload —
 * what the event editor sends — maps exactly as it always did.
 */

import { mapClientEventPatchToGoogle, mapClientEventToGoogle } from "../lib/google.ts";

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log("✓ " + name); }
  else { failed++; console.log("✗ " + name + (detail ? "  -> " + detail : "")); }
};
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
        `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const full = {
  title: "Weekly standup",
  description: "Agenda",
  location: "Room 4",
  start: "2026-09-08T14:00:00.000Z",
  end: "2026-09-08T14:30:00.000Z",
  allDay: false,
  attendees: ["a@example.com", "b@example.com"],
  recurrence: ["RRULE:FREQ=WEEKLY"],
  reminders: { useDefault: true, overrides: [] },
  eventType: "meeting",
  colorId: "5",
  timeZone: "America/New_York",
};

/* ── A full payload is unchanged ──────────────────────────────────── */

// The editor sends every field on purpose, including an emptied guest list
// when the user removed everyone. That must keep working exactly as before.
eq("a full payload maps identically to the create mapper",
   mapClientEventPatchToGoogle(full), mapClientEventToGoogle(full));
eq("an explicitly emptied guest list is still sent",
   mapClientEventPatchToGoogle({ ...full, attendees: [] }).attendees, []);

/* ── A drag sends when, and only when ─────────────────────────────── */

{
  const moved = mapClientEventPatchToGoogle({
    start: "2026-09-08T16:00:00.000Z",
    end: "2026-09-08T16:30:00.000Z",
    allDay: false,
    timeZone: "America/New_York",
  });
  eq("a move carries only start and end", Object.keys(moved).sort(), ["end", "start"]);
  for (const key of ["attendees", "recurrence", "colorId", "reminders", "summary", "location", "description", "extendedProperties"]) {
    check(`a move leaves ${key} untouched`, !(key in moved));
  }
  eq("a timed start keeps its zone",
     moved.start, { dateTime: "2026-09-08T16:00:00.000Z", timeZone: "America/New_York" });
}

/* ── A doc sync sends what a doc owns ─────────────────────────────── */

{
  // What the docs panel, the doc save path and the canvas now send.
  const synced = mapClientEventPatchToGoogle({
    title: "Weekly standup",
    description: "Notes typed into the doc",
    location: undefined,
    start: "2026-09-08T14:00:00.000Z",
    end: "2026-09-08T14:30:00.000Z",
    allDay: false,
    timeZone: "America/New_York",
  });
  check("a doc sync does not touch the guest list", !("attendees" in synced));
  check("a doc sync does not touch recurrence", !("recurrence" in synced));
  check("a doc sync does not recolour the event", !("colorId" in synced));
  check("a doc sync does not reset reminders", !("reminders" in synced));
  check("an unknown location is left alone rather than blanked", !("location" in synced));
  eq("a doc sync does update the title", synced.summary, "Weekly standup");
  eq("a doc sync does update the description", synced.description, "Notes typed into the doc");
}

/* ── All-day dates ────────────────────────────────────────────────── */

eq("an all-day start is sent as a date",
   mapClientEventPatchToGoogle({ start: "2026-09-08", end: "2026-09-09", allDay: true }).start,
   { date: "2026-09-08" });

eq("an empty patch sends nothing at all", mapClientEventPatchToGoogle({}), {});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
