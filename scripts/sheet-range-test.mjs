/**
 * Tests for sheet ranges, copy and paste.
 *
 * The clipboard is where spreadsheets quietly get things wrong: corners
 * arriving in the wrong order, a trailing newline inventing a row, an empty
 * pasted cell leaving a stale value behind. All of that is arithmetic on
 * strings, so it is tested here rather than through a browser.
 */

import {
  EMPTY_HISTORY,
  clearRange,
  normalizeRange,
  parseTSV,
  pasteAt,
  rangeContains,
  rangeRefs,
  rangeSize,
  rangeToRaw,
  rangeToTSV,
  pushHistory,
  redoHistory,
  undoHistory,
} from "../lib/sheet.ts";

let passed = 0;
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log("✓ " + name); }
  else { failed++; console.log("✗ " + name + (detail ? "  -> " + detail : "")); }
};
const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const cells = { A1: "1", B1: "2", A2: "3", B2: "=A2*2", C3: "text" };

/* ── Range shape ──────────────────────────────────────────────────── */

{
  // A selection is dragged from an anchor, just as often up and to the left.
  const fwd = normalizeRange({ row: 0, col: 0 }, { row: 2, col: 3 });
  const back = normalizeRange({ row: 2, col: 3 }, { row: 0, col: 0 });
  eq("a range normalises the same from either corner", JSON.stringify(fwd), JSON.stringify(back));
  check("a normalised range is ordered", fwd.r0 <= fwd.r1 && fwd.c0 <= fwd.c1);
  eq("range size counts every cell", rangeSize(fwd), 12);
  eq("a single cell is a 1x1 range", rangeSize(normalizeRange({ row: 1, col: 1 }, { row: 1, col: 1 })), 1);

  eq("rangeContains finds an inside cell", rangeContains(fwd, 1, 1), true);
  eq("rangeContains rejects a cell below", rangeContains(fwd, 5, 1), false);
  eq("rangeContains rejects a cell to the right", rangeContains(fwd, 1, 9), false);
  eq("rangeRefs walks row-major", rangeRefs({ r0: 0, c0: 0, r1: 1, c1: 1 }).join(","), "A1,B1,A2,B2");
}

/* ── Copying ──────────────────────────────────────────────────────── */

{
  // The clipboard gets what the user was looking at: values, not formulas.
  const tsv = rangeToTSV({ r0: 0, c0: 0, r1: 1, c1: 1 }, cells);
  eq("TSV uses tabs between columns and newlines between rows", tsv, "1\t2\n3\t6");
  check("a formula copies out as its evaluated value", tsv.includes("6"));

  // Copying inside milindCal keeps the formula, so a paste stays live.
  const raw = rangeToRaw({ r0: 1, c0: 0, r1: 1, c1: 1 }, cells);
  eq("a raw copy keeps the formula text", raw[0][1], "=A2*2");
  eq("a raw copy keeps its shape", raw.length + "x" + raw[0].length, "1x2");
  eq("a raw copy renders an empty cell as empty", rangeToRaw({ r0: 8, c0: 8, r1: 8, c1: 8 }, cells)[0][0], "");
}

/* ── Parsing what a clipboard actually carries ────────────────────── */

{
  eq("parseTSV splits tabs and newlines", JSON.stringify(parseTSV("a\tb\nc\td")), '[["a","b"],["c","d"]]');
  eq("parseTSV handles CRLF from Windows and Excel", JSON.stringify(parseTSV("a\tb\r\nc\td")), '[["a","b"],["c","d"]]');
  eq("parseTSV handles a lone CR", JSON.stringify(parseTSV("a\rb")), '[["a"],["b"]]');
  eq("a trailing newline does not invent a row", parseTSV("a\nb\n").length, 2);
  eq("empty text is a single empty cell", JSON.stringify(parseTSV("")), '[[""]]');
  eq("a single value is a 1x1 grid", JSON.stringify(parseTSV("hello")), '[["hello"]]');
  // A ragged paste keeps its rows; the writer simply fills what it is given.
  eq("ragged rows are preserved", JSON.stringify(parseTSV("a\tb\nc")), '[["a","b"],["c"]]');
}

/* ── Pasting ──────────────────────────────────────────────────────── */

{
  const pasted = pasteAt(cells, { row: 4, col: 1 }, [["x", "y"], ["z", ""]]);
  eq("paste writes at the anchor", pasted.B5, "x");
  eq("paste fills across", pasted.C5, "y");
  eq("paste fills down", pasted.B6, "z");
  check("an empty pasted cell clears instead of storing", !("C6" in pasted));
  eq("paste leaves untouched cells alone", pasted.A1, "1");
  check("paste does not mutate the original map", !("B5" in cells));

  // The case that leaves stale data behind if empty is treated as "skip".
  const over = pasteAt({ Z9: "old" }, { row: 8, col: 25 }, [[""]]);
  check("pasting empty over a value clears it", !("Z9" in over));

  // Pasting a formula keeps it a formula.
  const f = pasteAt({}, { row: 0, col: 0 }, [["=1+1"]]);
  eq("a pasted formula stays a formula", f.A1, "=1+1");
}

/* ── Clearing ─────────────────────────────────────────────────────── */

{
  const cleared = clearRange(cells, { r0: 0, c0: 0, r1: 1, c1: 1 });
  check("clearRange removes every cell in it", !["A1", "B1", "A2", "B2"].some((k) => k in cleared));
  eq("clearRange leaves cells outside alone", cleared.C3, "text");
  eq("clearRange does not mutate the original", cells.A1, "1");
  eq("clearing an already-empty range is a no-op", Object.keys(clearRange({}, { r0: 0, c0: 0, r1: 3, c1: 3 })).length, 0);
}

/* ── Undo history ─────────────────────────────────────────────────── */

{
  const h0 = EMPTY_HISTORY;
  eq("nothing to undo at the start", undoHistory(h0, "b"), null);
  eq("nothing to redo at the start", redoHistory(h0, "b"), null);

  // a -> b -> c
  const h1 = pushHistory(h0, "a");
  const h2 = pushHistory(h1, "b");
  eq("history records what was replaced", h2.past.join(","), "a,b");

  const u1 = undoHistory(h2, "c");
  eq("undo returns the previous state", u1.value, "b");
  eq("undo moves the present into the future", u1.history.future.join(","), "c");
  const u2 = undoHistory(u1.history, u1.value);
  eq("a second undo goes back further", u2.value, "a");
  eq("the future stacks in order", u2.history.future.join(","), "b,c");
  eq("undo stops at the beginning", undoHistory(u2.history, u2.value), null);

  // Redo walks back out again.
  const r1 = redoHistory(u2.history, u2.value);
  eq("redo returns the state undone out of", r1.value, "b");
  const r2 = redoHistory(r1.history, r1.value);
  eq("redo continues forward", r2.value, "c");
  eq("redo stops at the end", redoHistory(r2.history, r2.value), null);

  // A fresh edit after undoing forks the timeline: the abandoned branch is
  // gone, which is what every editor does and what users expect.
  const forked = pushHistory(u2.history, "a");
  eq("editing after undo drops the redo branch", forked.future.length, 0);
  eq("and still records the edit", forked.past.length, u2.history.past.length + 1);

  // Bounded, because each entry is a whole cell map.
  let big = EMPTY_HISTORY;
  for (let i = 0; i < 10; i++) big = pushHistory(big, "s" + i, 4);
  eq("history is capped", big.past.length, 4);
  eq("the cap drops the oldest, not the newest", big.past.join(","), "s6,s7,s8,s9");

  // Immutability: callers hold on to old history objects.
  const before = pushHistory(EMPTY_HISTORY, "x");
  const after = pushHistory(before, "y");
  eq("pushHistory does not mutate its input", before.past.join(","), "x");
  eq("and returns a new history", after.past.join(","), "x,y");
  const uu = undoHistory(after, "z");
  eq("undoHistory does not mutate its input", after.past.join(","), "x,y");
  eq("undo leaves the caller a fresh history", uu.history.past.join(","), "x");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
