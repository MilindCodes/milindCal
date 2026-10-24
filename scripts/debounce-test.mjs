/**
 * Tests for the autosave debounce. The property that matters is the one an
 * ordinary debounce lacks: a pending save can be run on the way out instead of
 * being cleared, so typing inside the delay window is never lost.
 */

import { flushableDebounce } from "../lib/debounce.ts";

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log("✓ " + name); }
  else { failed++; console.log("✗ " + name + (detail ? "  -> " + detail : "")); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

{
  const saves = [];
  const d = flushableDebounce(30);
  d.schedule(() => saves.push("a"));
  d.schedule(() => saves.push("ab"));
  d.schedule(() => saves.push("abc"));
  check("nothing saves inside the delay", saves.length === 0);
  await sleep(60);
  check("only the latest call runs once the delay passes", JSON.stringify(saves) === '["abc"]', JSON.stringify(saves));
}

{
  // The bug: typing, then leaving before the delay elapses.
  const saves = [];
  const d = flushableDebounce(500);
  d.schedule(() => saves.push("the sentence just finished"));
  d.flush(); // what unmount now does
  check("flush saves the pending call immediately", saves.length === 1);
  await sleep(20);
  check("and the timer does not save it a second time", saves.length === 1);
  check("nothing is pending afterwards", d.isPending() === false);
}

{
  // What unmount used to do, for contrast: the save never happens.
  const saves = [];
  const d = flushableDebounce(30);
  d.schedule(() => saves.push("lost"));
  d.cancel();
  await sleep(60);
  check("cancel drops the pending call, which is why unmount must not use it", saves.length === 0);
}

{
  const d = flushableDebounce(30);
  let ran = 0;
  d.flush();
  check("flushing with nothing pending is a no-op", ran === 0 && d.isPending() === false);
  // A save that schedules another save must not be swallowed.
  d.schedule(() => { ran++; d.schedule(() => { ran++; }); });
  d.flush();
  check("a call scheduled during a flush survives it", d.isPending() === true);
  d.flush();
  check("and runs when flushed in turn", ran === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
