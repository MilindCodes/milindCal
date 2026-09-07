"use client";

/**
 * Pointer dragging for the time grid: move, resize, and drag-to-create.
 *
 * Pointer events rather than mouse events, so touch and pen work without a
 * second code path, and the grid takes pointer capture on the way down so a
 * drag that leaves the element still tracks and still finishes. Losing the
 * pointer mid-drag is how grids end up stuck holding an event.
 *
 * The hook only computes what the drag *would* do. Committing is the caller's
 * job, which keeps the store and this file unaware of each other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveDrag,
  type DragKind,
  type DragResult,
  type DragState,
  type TimeAxis,
} from "@/lib/calendar-grid";

export type { DragKind, DragResult, DragState };

interface Options {
  days: Date[];
  axis: TimeAxis;
  /** Pixels of movement before a press becomes a drag rather than a click. */
  threshold?: number;
  onCommit: (kind: DragKind, result: DragResult, eventId?: string) => void;
}

/** A press shorter than this in pixels is a click, not a drag. */
const DEFAULT_THRESHOLD = 4;

export function useGridDrag({ days, axis, threshold = DEFAULT_THRESHOLD, onCommit }: Options) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // The live drag also lives in a ref: the pointer handlers are attached once
  // and would otherwise close over the state from the render that attached them.
  const dragRef = useRef<DragState | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const colRectsRef = useRef<DOMRect[]>([]);

  const setBoth = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const snap = useCallback(
    (minutes: number) => Math.round(minutes / axis.slotMinutes) * axis.slotMinutes,
    [axis.slotMinutes],
  );

  const minutesFromY = useCallback(
    (clientY: number) => {
      const el = bodyRef.current;
      if (!el) return axis.minMinutes;
      const rect = el.getBoundingClientRect();
      const frac = (clientY - rect.top) / rect.height;
      const raw = axis.minMinutes + frac * (axis.maxMinutes - axis.minMinutes);
      return Math.min(axis.maxMinutes, Math.max(axis.minMinutes, raw));
    },
    [axis],
  );

  const dayFromX = useCallback((clientX: number) => {
    const rects = colRectsRef.current;
    if (rects.length === 0) return 0;
    for (let i = 0; i < rects.length; i++) {
      if (clientX >= rects[i].left && clientX <= rects[i].right) return i;
    }
    // Outside the columns: clamp to the nearest edge rather than snapping to 0,
    // so dragging past the last day does not throw the event back to Sunday.
    return clientX < rects[0].left ? 0 : rects.length - 1;
  }, []);

  const begin = useCallback(
    (
      e: React.PointerEvent,
      kind: DragKind,
      dayIndex: number,
      event?: { id: string; start: Date; end: Date },
    ) => {
      // Left button (or touch/pen) only; a right-click must not start a drag.
      if (e.button !== 0) return;
      const cols = bodyRef.current?.querySelectorAll(".tg__col");
      colRectsRef.current = cols ? [...cols].map((c) => c.getBoundingClientRect()) : [];
      originRef.current = { x: e.clientX, y: e.clientY };
      const minutes = minutesFromY(e.clientY);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setBoth({
        kind,
        eventId: event?.id,
        fromDay: dayIndex,
        fromMinutes: minutes,
        toDay: dayIndex,
        toMinutes: minutes,
        originStart: event?.start,
        originEnd: event?.end,
        moved: false,
      });
    },
    [minutesFromY, setBoth],
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const origin = originRef.current;
      const moved =
        cur.moved ||
        (origin
          ? Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > threshold
          : false);
      setBoth({
        ...cur,
        toDay: cur.kind === "resize" ? cur.fromDay : dayFromX(e.clientX),
        toMinutes: minutesFromY(e.clientY),
        moved,
      });
    };

    const onUp = () => {
      const cur = dragRef.current;
      setBoth(null);
      originRef.current = null;
      if (!cur || !cur.moved) return; // a click, handled elsewhere
      const result = resolveDrag(cur, days, axis);
      if (result) onCommit(cur.kind, result, cur.eventId);
    };

    const onCancel = () => {
      setBoth(null);
      originRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag, days, axis, threshold, dayFromX, minutesFromY, onCommit, setBoth, snap]);

  return { bodyRef, drag, begin };
}
