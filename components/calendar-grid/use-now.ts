"use client";

/**
 * The current time, and deliberately `null` until the component has mounted.
 *
 * Every "now" the calendar draws — the time line, the today column, the today
 * pill in the header — depends on a clock the server does not have. It renders
 * the HTML at one instant, in its own timezone; the browser hydrates at a
 * different instant, in the user's. The two never agreed, so React logged a
 * hydration mismatch on every single page load:
 *
 *     top: "61.6904761904762%"   (server)
 *     top: "61.6889%"            (client)
 *
 * There is no value the server could have sent that would have matched, and a
 * timezone-shifted server can disagree about the *date* too, not just the
 * minute. So the answer is not a better guess — it is that "now" does not
 * exist until there is a browser to ask. Callers render nothing time-dependent
 * while this is null, and the real value arrives on the first commit.
 *
 * `tick` gates the every-minute update, not the initial read: a grid with no
 * time indicator still needs to know which column is today, and still needs
 * that to stop being yesterday once midnight passes.
 */

import { useEffect, useState } from "react";

export function useNow(tick = true): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (!tick) return;
    // Minute resolution is all any of this needs; ticking faster would
    // re-render the whole grid for a line that has not visibly moved.
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [tick]);

  return now;
}
