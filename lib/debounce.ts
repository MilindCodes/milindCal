/**
 * A debounce whose pending call can be run now instead of thrown away.
 *
 * The ordinary way to cancel a debounce on unmount is `clearTimeout`, and for
 * an autosave that is data loss: whatever was typed inside the delay window
 * simply never saves. milindDocs did exactly that — finish a sentence, click
 * the next document within half a second, and the sentence was gone, because
 * switching documents unmounts the editor and the cleanup cleared the timer.
 *
 * `flush()` runs the pending call immediately and `cancel()` drops it, so the
 * caller has to choose, and the unmount path chooses to save.
 */
export function flushableDebounce(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Taken before running, so a call that schedules another save is not
    // swallowed by this one finishing.
    const run = pending;
    pending = null;
    run?.();
  };

  return {
    /** Replace whatever is pending with `run`, and restart the delay. */
    schedule(run: () => void) {
      pending = run;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    /** Run the pending call now, if there is one. */
    flush,
    /** Drop the pending call without running it. */
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    isPending: () => pending !== null,
  };
}
