"use client";

import { useEffect, useRef } from "react";

const CURSOR_RADIUS = 6; // px — half of 12px diameter

export function CursorTrail() {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only override cursor on fine-pointer (mouse) devices...
    if (!window.matchMedia("(pointer: fine)").matches) return;
    // ...and never for someone who asked for reduced motion: a JS-driven dot
    // chasing the pointer is exactly the kind of movement that setting opts
    // out of, and they're better served by their own system cursor.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dot = dotRef.current;
    if (!dot) return;

    // Only now — with the element in hand and about to be driven — do we let
    // the stylesheet hide the native cursor. Anything that prevents us
    // reaching this line leaves the real cursor in place.
    const root = document.documentElement;
    root.classList.add("custom-cursor-active");

    // rAF-coalesce pointermove so the DOM write happens at most once per
    // frame instead of on every pointer event (~120Hz on modern trackpads).
    let nextX = 0;
    let nextY = 0;
    let hasPending = false;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      hasPending = false;
      dot.style.transform = `translate(${nextX - CURSOR_RADIUS}px, ${nextY - CURSOR_RADIUS}px)`;
      if (dot.style.opacity !== "1") dot.style.opacity = "1";
    };

    const onMove = (e: PointerEvent) => {
      nextX = e.clientX;
      nextY = e.clientY;
      if (hasPending) return;
      hasPending = true;
      rafId = requestAnimationFrame(flush);
    };

    const onLeave = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        hasPending = false;
      }
      dot.style.opacity = "0";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      root.classList.remove("custom-cursor-active");
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <div
      aria-hidden
      ref={dotRef}
      className="custom-cursor"
    />
  );
}
