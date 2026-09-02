/**
 * Batched localStorage writer.
 *
 * Many rapid mutations (drag-over frames, keystroke-driven state, kanban
 * reorders) would otherwise call localStorage.setItem dozens of times per
 * second. That blocks the main thread — each setItem is synchronous and
 * JSON.stringify on large blobs is expensive.
 *
 * We coalesce writes: each call to writeBatched(key, value) overwrites any
 * pending value for that key and schedules a single rAF flush. Multiple keys
 * share the same flush, so one animation frame drains the whole queue.
 */

type Pending = Map<string, unknown>;

const pending: Pending = new Map();
let flushScheduled = false;

function flush() {
  flushScheduled = false;
  if (typeof window === "undefined") return;
  for (const [key, value] of pending) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota exceeded / private browsing — drop silently
    }
  }
  pending.clear();
}

export function writeBatched(key: string, value: unknown): void {
  pending.set(key, value);
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof window === "undefined") {
    flush();
    return;
  }
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 0);
  }
}

export function flushBatchedNow(): void {
  if (!flushScheduled) return;
  flush();
}

// Safety net: rAF is throttled/suspended for hidden or backgrounded tabs, so a
// pending write can sit unflushed indefinitely if the tab is switched away
// from (or closed) before its next paint. Flush eagerly whenever the page is
// about to stop being visible, so a pending edit is never lost to that gap.
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBatchedNow();
  });
  window.addEventListener("pagehide", flushBatchedNow);
}

export function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
