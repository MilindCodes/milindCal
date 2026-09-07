"use client";

import { useState } from "react";
import { MonthGrid, YearGrid } from "@/components/calendar-grid/month-grid";
import { TimeGrid, type GridEvent } from "@/components/calendar-grid/time-grid";
import { addDays, startOfDay, weekDays } from "@/lib/calendar-grid";

/** Events chosen to be awkward: the shapes that break naive layout code. */
function sampleEvents(days: Date[]): GridEvent[] {
  const on = (dayIndex: number, from: string, to: string): { start: Date; end: Date } => {
    const base = startOfDay(days[dayIndex]);
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const start = new Date(base);
    start.setHours(fh, fm, 0, 0);
    const end = new Date(base);
    end.setHours(th, tm, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
    return { start, end };
  };

  return [
    // A stack of three, to exercise column assignment.
    { id: "a", title: "Design review", accent: "#b42a3a", ...on(1, "09:00", "12:00") },
    { id: "b", title: "Standup", accent: "#7a1320", ...on(1, "09:30", "10:00") },
    { id: "c", title: "Pairing", accent: "#8a6a6f", ...on(1, "09:45", "11:00") },
    // Back-to-back: must each be full width, not half.
    { id: "d", title: "1:1", accent: "#b42a3a", ...on(2, "13:00", "14:00") },
    { id: "e", title: "Retro", accent: "#7a1320", ...on(2, "14:00", "15:00") },
    // One short event beside a long one: the expansion pass should widen it.
    { id: "f", title: "Deep work", accent: "#5b3a40", ...on(3, "09:00", "13:00") },
    { id: "g", title: "Coffee", accent: "#b42a3a", ...on(3, "10:00", "10:15") },
    // Crosses midnight: should draw on two days, clipped to each.
    { id: "h", title: "Deploy window", accent: "#7a1320", ...on(4, "22:00", "02:00") },
    // Starts before the axis: should clamp to the top rather than vanish.
    { id: "i", title: "Early flight", accent: "#5b3a40", ...on(5, "05:00", "07:30") },
    // A minute long: must stay clickable.
    { id: "j", title: "Ping", accent: "#b42a3a", ...on(5, "15:00", "15:01") },
    // Completed, and an all-day.
    { id: "k", title: "Ship the grid", accent: "#8a6a6f", done: true, ...on(2, "16:00", "17:00") },
    {
      id: "l",
      title: "Conference",
      accent: "#b42a3a",
      allDay: true,
      start: startOfDay(days[2]),
      end: addDays(startOfDay(days[4]), 1),
    },
  ];
}

export function GridPreview() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"week" | "day" | "month" | "year">("week");
  const dayCount = view === "day" ? 1 : 7;
  const week = weekDays(anchor, 0);
  const days = dayCount === 7 ? week : [startOfDay(anchor)];

  // Held in state so drags actually move things: a harness where nothing
  // changes cannot tell you whether the gesture worked.
  const [events, setEvents] = useState<GridEvent[]>(() => sampleEvents(weekDays(new Date(), 0)));
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((l) => [line, ...l].slice(0, 5));
  const hm = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 16, gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
          Time grid harness
        </strong>
        <button onClick={() => setAnchor((d) => addDays(d, -7))} type="button">Prev</button>
        <button onClick={() => setAnchor(new Date())} type="button">Today</button>
        <button onClick={() => setAnchor((d) => addDays(d, 7))} type="button">Next</button>
        {(["week", "day", "month", "year"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{ fontWeight: view === v ? 700 : 400 }}
            type="button"
          >
            {v}
          </button>
        ))}
        <button onClick={() => setEvents(sampleEvents(weekDays(new Date(), 0)))} type="button">
          Reset
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
          {days[0].toDateString()}
        </span>
      </div>
      <pre
        id="harness-log"
        style={{
          margin: 0, fontSize: "0.7rem", lineHeight: 1.5, color: "var(--ink-2)",
          fontFamily: "var(--font-mono)", minHeight: "1.5em",
        }}
      >
        {log.join("\n")}
      </pre>
      <div style={{ flex: 1, minHeight: 0 }}>
        {view === "month" ? (
          <MonthGrid
            anchor={anchor}
            events={events}
            onDayClick={(d) => note("day     " + d.toDateString())}
            onEventClick={(e) => note("click   " + e.title)}
            onMoreClick={(d, n) => note(`more    ${d.toDateString()}  +${n}`)}
          />
        ) : view === "year" ? (
          <YearGrid
            events={events}
            onDayClick={(d) => note("day     " + d.toDateString())}
            year={anchor.getFullYear()}
          />
        ) : (
        <TimeGrid
          days={days}
          events={events}
          onCreate={(start, end) => {
            const id = "new-" + Math.random().toString(36).slice(2, 7);
            setEvents((prev) => [...prev, { id, title: "New event", accent: "#b42a3a", start, end }]);
            note(`create  ${start.toDateString().slice(0, 10)}  ${hm(start)}–${hm(end)}`);
          }}
          onEventChange={(id, start, end) => {
            setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, start, end } : e)));
            note(`change  ${id}  ${start.toDateString().slice(0, 10)}  ${hm(start)}–${hm(end)}`);
          }}
          onEventClick={(e) => note("click   " + e.title)}
          onSlotClick={(s) => note("slot    " + hm(s))}
        />
        )}
      </div>
    </div>
  );
}
