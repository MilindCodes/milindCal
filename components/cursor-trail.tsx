"use client";

import { useEffect, useRef, useState } from "react";

type ShapeKind = "square" | "triangle" | "circle";

interface TrailItem {
  id: number;
  x: number;
  y: number;
  shape: ShapeKind;
  color: string;
  size: number;
  rotation: number;
  driftX: number;
  driftY: number;
  createdAt: number;
}

const SHAPE_PATTERN: ShapeKind[] = ["square", "triangle", "circle"];
const COLOR_PATTERN = ["#ef4444", "#3b82f6", "#facc15", "#10b981", "#a855f7", "#f97316"];
const TRAIL_LIFETIME_MS = 900;
const SPAWN_INTERVAL_MS = 55;
const CLEANUP_INTERVAL_MS = 120;
const MAX_TRAIL_ITEMS = 36;

export function CursorTrail() {
  const [items, setItems] = useState<TrailItem[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, active: false, lastMoveAt: 0 });
  const idRef = useRef(0);
  const shapeIndexRef = useRef(0);
  const colorIndexRef = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer:fine)").matches;

    if (reduceMotion || !finePointer) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        active: true,
        lastMoveAt: Date.now()
      };
    };

    const onPointerLeave = () => {
      pointerRef.current.active = false;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);

    const spawnTimer = window.setInterval(() => {
      const now = Date.now();
      const pointer = pointerRef.current;

      if (!pointer.active || now - pointer.lastMoveAt > 140) {
        return;
      }

      const shape = SHAPE_PATTERN[shapeIndexRef.current % SHAPE_PATTERN.length];
      const color = COLOR_PATTERN[colorIndexRef.current % COLOR_PATTERN.length];

      shapeIndexRef.current += 1;
      colorIndexRef.current += 1;
      idRef.current += 1;

      const size = 12 + (shapeIndexRef.current % 4) * 3;

      const nextItem: TrailItem = {
        id: idRef.current,
        x: pointer.x,
        y: pointer.y,
        shape,
        color,
        size,
        rotation: -35 + Math.random() * 70,
        driftX: -30 + Math.random() * 60,
        driftY: 16 + Math.random() * 34,
        createdAt: now
      };

      setItems((previous) => {
        const activeItems = previous.filter((item) => now - item.createdAt < TRAIL_LIFETIME_MS);
        return [...activeItems, nextItem].slice(-MAX_TRAIL_ITEMS);
      });
    }, SPAWN_INTERVAL_MS);

    const cleanupTimer = window.setInterval(() => {
      const now = Date.now();
      setItems((previous) => previous.filter((item) => now - item.createdAt < TRAIL_LIFETIME_MS));
    }, CLEANUP_INTERVAL_MS);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      window.clearInterval(spawnTimer);
      window.clearInterval(cleanupTimer);
    };
  }, []);

  if (!items.length) {
    return null;
  }

  return (
    <div aria-hidden className="cursor-trail-layer">
      {items.map((item) => (
        <span
          className={`cursor-shape ${item.shape}`}
          key={item.id}
          style={{
            left: item.x,
            top: item.y,
            width: item.size,
            height: item.size,
            backgroundColor: item.color,
            ["--trail-dx" as string]: `${item.driftX}px`,
            ["--trail-dy" as string]: `${item.driftY}px`,
            ["--trail-rotate" as string]: `${item.rotation}deg`
          }}
        />
      ))}
    </div>
  );
}
