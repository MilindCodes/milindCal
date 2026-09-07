"use client";

import { useState } from "react";
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
  const [dayCount, setDayCount] = useState<1 | 7>(7);

  const week = weekDays(anchor, 0);
  const days = dayCount === 7 ? week : [startOfDay(anchor)];
  const events = sampleEvents(week);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", padding: 16, gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem" }}>
          Time grid harness
        </strong>
        <button onClick={() => setAnchor((d) => addDays(d, -7))} type="button">Prev</button>
        <button onClick={() => setAnchor(new Date())} type="button">Today</button>
        <button onClick={() => setAnchor((d) => addDays(d, 7))} type="button">Next</button>
        <button onClick={() => setDayCount((c) => (c === 7 ? 1 : 7))} type="button">
          {dayCount === 7 ? "Day view" : "Week view"}
        </button>
        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
          {days[0].toDateString()}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TimeGrid
          days={days}
          events={events}
          onEventClick={(e) => console.log("event", e.id, e.title)}
          onSlotClick={(s) => console.log("slot", s.toString())}
        />
      </div>
    </div>
  );
}
