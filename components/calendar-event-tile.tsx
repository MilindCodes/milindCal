"use client";

/**
 * FullCalendar event content with a dnd-kit drag handle.
 *
 * FC owns the event tile's chrome, sizing, and its own move/resize drag on
 * the tile body. We take over the small grip in the corner: pointer events
 * there are captured by dnd-kit's useDraggable, so the user can drag the
 * event out of the calendar and onto a task kanban column, the docs list,
 * or any other droppable. stopPropagation prevents FC from initiating its
 * own drag in parallel.
 */

import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { payloadFromEvent } from "@/lib/entity-store";
import type { CalendarEvent } from "@/lib/models";

interface CalendarEventTileProps {
  /** FC gives us its own view of the event; we carry the rich CalendarEvent
   *  so we can produce a full UniversalDragPayload without another lookup. */
  event: CalendarEvent;
  /** FC renders time + title; we do the same so we don't lose its formatting
   *  (all-day vs timed, cross-day chips, etc.). Keep styles identical. */
  timeText: string;
  isStart: boolean;
  allDay: boolean;
}

function CalendarEventTileImpl({ event, timeText, isStart, allDay }: CalendarEventTileProps) {
  const payload = payloadFromEvent(event);
  const dragId = `event:${event.calendarId}::${event.id}`;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { payload },
  });

  return (
    <div className={`fc-event-tile-inner${isDragging ? " fc-event-tile-inner--dragging" : ""}`}>
      <div className="fc-event-tile-body">
        {!allDay && isStart && timeText ? (
          <span className="fc-event-tile-time">{timeText}</span>
        ) : null}
        <span className="fc-event-tile-title">{event.title || "(untitled)"}</span>
      </div>
      <button
        ref={setNodeRef}
        type="button"
        className="universal-event-handle"
        aria-label="Drag event to another view"
        // stop FC's pointer handlers from firing so it doesn't start moving
        // the event inside the grid while dnd-kit is taking it out.
        onPointerDown={(e) => { e.stopPropagation(); }}
        onMouseDown={(e) => { e.stopPropagation(); }}
        {...listeners}
        {...attributes}
      >
        <GripVertical size={10} />
      </button>
    </div>
  );
}

/**
 * Memoized: FullCalendar re-invokes the content renderer for every visible
 * event on each data poll, but the underlying CalendarEvent objects keep a
 * stable identity across polls (the cache only replaces changed entries), so
 * unchanged tiles skip re-rendering entirely.
 */
export const CalendarEventTile = memo(CalendarEventTileImpl);
