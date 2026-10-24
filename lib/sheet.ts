/**
 * The sheet facet.
 *
 * A record with a `sheet` opens in the grid, exactly as `start` puts it on the
 * calendar and `body` opens it in the editor. Nothing about being a spreadsheet
 * is a separate type — it is one more face of the same record.
 *
 * Cells are stored sparsely (`{ A1: "12", B2: "=SUM(A1:A5)" }`) rather than as
 * a dense 2-D array: most grids are mostly empty, and a sparse map keeps the
 * serialised record small, which matters because records sync on every edit.
 */

/* The shape and the default live in sheet-data.ts, which has no code in it.
 * The calendar and the record model need DEFAULT_SHEET at startup; importing
 * it from here dragged this whole module — the formula engine included — onto
 * the first-load path, though the grid that uses the engine is lazy-loaded. */
export { DEFAULT_SHEET, type SheetData } from "./sheet-data";

/* ── A1 notation ──────────────────────────────────────────────────── */

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** "A" -> 0, "AA" -> 26. Returns -1 for anything that isn't column letters. */
export function columnIndex(name: string): number {
  if (!/^[A-Z]+$/.test(name)) return -1;
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  const col = columnIndex(m[1]);
  const row = Number.parseInt(m[2], 10) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
}

/** Every ref covered by "A1:B3", in row-major order. */
function expandRange(from: string, to: string): string[] {
  const a = parseRef(from);
  const b = parseRef(to);
  if (!a || !b) return [];
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      out.push(cellRef(r, c));
    }
  }
  return out;
}

/* ── Evaluation ───────────────────────────────────────────────────── */

export type CellValue = number | string;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Excel and Sheets agree: the average of no numbers is a division by zero. */
const mean = (xs: number[]) => {
  if (!xs.length) throw new Error("#DIV/0!");
  return sum(xs) / xs.length;
};

/* reduce rather than Math.min(...xs): spreading a large range into arguments
 * overflows the call stack somewhere past a hundred thousand cells. */
const FUNCTIONS: Record<string, (xs: number[]) => number> = {
  SUM: sum,
  AVERAGE: mean,
  AVG: mean,
  MIN: (xs) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : 0),
  MAX: (xs) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : 0),
  COUNT: (xs) => xs.length,
  PRODUCT: (xs) => xs.reduce((a, b) => a * b, 1),
  ROUND: (xs) => (xs.length ? Math.round(xs[0] * 10 ** (xs[1] ?? 0)) / 10 ** (xs[1] ?? 0) : 0),
  ABS: (xs) => Math.abs(xs[0] ?? 0),
};

/**
 * What a cell contributes as an operand.
 *
 * Blank and text have to stay distinguishable from 0. Every range used to be
 * read through one function that returned 0 for both, so the aggregates could
 * not tell a gap from a zero: AVERAGE of 2, blank, 4 was 2 rather than 3,
 * COUNT counted blanks and labels, and MIN of 5, blank, 7 was 0.
 */
type Operand = number | "blank" | "text";

interface EvalContext {
  cells: Record<string, string>;
  /** Every formula already resolved in this pass, errors included. */
  memo: Map<string, number | { error: string }>;
  /** Cells on the current resolution path, so a cycle reports #CYCLE!. */
  visiting: Set<string>;
}

function errorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return message.startsWith("#") ? message : "#ERROR!";
}

function readCell(key: string, ctx: EvalContext): Operand {
  const raw = ctx.cells[key];
  if (raw === undefined || raw.trim() === "") return "blank";
  if (!raw.startsWith("=")) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : "text";
  }
  const cached = ctx.memo.get(key);
  if (cached !== undefined) {
    if (typeof cached === "number") return cached;
    throw new Error(cached.error);
  }
  if (ctx.visiting.has(key)) throw new Error("#CYCLE!");
  ctx.visiting.add(key);
  try {
    const value = evaluateExpression(raw.slice(1), ctx);
    ctx.memo.set(key, value);
    return value;
  } catch (err) {
    // An error is a result too: cache it, so a broken cell referenced from a
    // hundred places is worked out once rather than a hundred times.
    const code = errorCode(err);
    ctx.memo.set(key, { error: code });
    throw new Error(code);
  } finally {
    ctx.visiting.delete(key);
  }
}

/**
 * Recursive-descent evaluator over a small expression grammar:
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := factor (("*" | "/") factor)*
 *   factor  := "-"? primary ("^" factor)?
 *   primary := number | ref | range | call | "(" expr ")"
 *
 * Cell references resolve through the context's memo, so within one pass
 * every formula is evaluated exactly once.
 */
function evaluateExpression(input: string, ctx: EvalContext): number {
  let pos = 0;
  const src = input;

  const skipWs = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };
  const peek = () => { skipWs(); return src[pos]; };
  const eat = (ch: string) => { skipWs(); if (src[pos] === ch) { pos++; return true; } return false; };

  function parseExpr(): number {
    let left = parseTerm();
    for (;;) {
      skipWs();
      const ch = src[pos];
      if (ch === "+") { pos++; left += parseTerm(); }
      else if (ch === "-") { pos++; left -= parseTerm(); }
      else return left;
    }
  }

  function parseTerm(): number {
    let left = parseFactor();
    for (;;) {
      skipWs();
      const ch = src[pos];
      if (ch === "*") { pos++; left *= parseFactor(); }
      else if (ch === "/") {
        pos++;
        const d = parseFactor();
        if (d === 0) throw new Error("#DIV/0!");
        left /= d;
      } else return left;
    }
  }

  function parseFactor(): number {
    skipWs();
    if (eat("-")) return -parseFactor();
    if (eat("+")) return parseFactor();
    const base = parsePrimary();
    skipWs();
    if (src[pos] === "^") { pos++; return base ** parseFactor(); }
    return base;
  }

  /**
   * A cell used in arithmetic. Blank is 0, as everywhere. Text is #VALUE!:
   * this used to count it as 0 on the grounds that that matches spreadsheet
   * convention, but Excel and Sheets both return #VALUE! for ="hello"+1, and
   * an error you can see beats a number that is silently wrong.
   */
  function refValue(ref: string): number {
    const operand = readCell(ref.toUpperCase(), ctx);
    if (typeof operand === "number") return operand;
    if (operand === "blank") return 0;
    throw new Error("#VALUE!");
  }

  /**
   * The numbers among some referenced cells; blanks and text are skipped.
   * An error in a referenced cell propagates — SUM over a range holding
   * #DIV/0! is #DIV/0! — unless `skipErrors`, which only COUNT asks for.
   */
  function numbersIn(refs: string[], skipErrors = false): number[] {
    const out: number[] = [];
    for (const ref of refs) {
      let operand: Operand;
      try {
        operand = readCell(ref.toUpperCase(), ctx);
      } catch (err) {
        if (skipErrors) continue;
        throw err;
      }
      if (typeof operand === "number") out.push(operand);
    }
    return out;
  }

  function parsePrimary(): number {
    skipWs();
    if (eat("(")) {
      const v = parseExpr();
      if (!eat(")")) throw new Error("#ERROR!");
      return v;
    }

    // number
    const numMatch = /^\d+(\.\d+)?/.exec(src.slice(pos));
    if (numMatch) { pos += numMatch[0].length; return Number(numMatch[0]); }

    // identifier: function call, range, or single ref
    const idMatch = /^[A-Za-z]+\d*/.exec(src.slice(pos));
    if (!idMatch) throw new Error("#ERROR!");
    const ident = idMatch[0];
    pos += ident.length;
    skipWs();

    // function call
    if (src[pos] === "(") {
      const fn = FUNCTIONS[ident.toUpperCase()];
      if (!fn) throw new Error("#NAME?");
      pos++;
      // COUNT counts numbers, and an error is not a number: Excel and Sheets
      // skip it rather than failing the count. Every other function here
      // propagates errors, as they do.
      const skipErrors = ident.toUpperCase() === "COUNT";
      const args: number[] = [];
      if (peek() !== ")") {
        for (;;) {
          args.push(...parseArg(skipErrors));
          if (eat(",")) continue;
          break;
        }
      }
      if (!eat(")")) throw new Error("#ERROR!");
      return fn(args);
    }

    // range
    if (src[pos] === ":") {
      pos++;
      const endMatch = /^[A-Za-z]+\d+/.exec(src.slice(pos));
      if (!endMatch) throw new Error("#ERROR!");
      pos += endMatch[0].length;
      const refs = expandRange(ident, endMatch[0]);
      if (!refs.length) throw new Error("#REF!");
      // A bare range outside a function collapses to its sum — SUM's rules.
      return sum(numbersIn(refs));
    }

    if (!parseRef(ident)) throw new Error("#NAME?");
    return refValue(ident);
  }

  /**
   * One function argument. A range, or a bare reference on its own, follows
   * the aggregate rule — numbers only, blanks and text skipped — the way
   * AVERAGE(A1, A2) treats an empty A2 in Excel. Anything else is an
   * expression and is evaluated as one.
   */
  function parseArg(skipErrors = false): number[] {
    skipWs();
    const rest = src.slice(pos);
    const range = /^([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/.exec(rest);
    if (range) {
      pos += range[0].length;
      const refs = expandRange(range[1], range[2]);
      if (!refs.length) throw new Error("#REF!");
      return numbersIn(refs, skipErrors);
    }
    const bare = /^([A-Za-z]+\d+)\s*(?=[,)])/.exec(rest);
    if (bare && parseRef(bare[1].toUpperCase())) {
      pos += bare[0].length;
      return numbersIn([bare[1]], skipErrors);
    }
    return [parseExpr()];
  }

  const result = parseExpr();
  skipWs();
  if (pos < src.length) throw new Error("#ERROR!");
  if (!Number.isFinite(result)) throw new Error("#NUM!");
  return result;
}

/* ── Evaluating a whole sheet ─────────────────────────────────────── */

/**
 * The cells a formula mentions. Deliberately loose — it may name a cell that
 * is not really a reference — because it only decides evaluation order, and
 * the evaluator itself stays correct whatever order it is handed.
 */
function referencedCells(formula: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Za-z]+\d+)(?:\s*:\s*([A-Za-z]+\d+))?\b/g;
  for (let m = re.exec(formula); m; m = re.exec(formula)) {
    if (m[2]) out.push(...expandRange(m[1], m[2]));
    else if (parseRef(m[1].toUpperCase())) out.push(m[1].toUpperCase());
  }
  return out;
}

/**
 * Every formula, ordered so each comes after the formulas it reads.
 *
 * An iterative depth-first walk, so ordering a long chain cannot overflow the
 * stack the way evaluating it recursively did. A cycle is left in place; the
 * evaluator reports it as #CYCLE!.
 */
function evaluationOrder(cells: Record<string, string>): string[] {
  const formulas = Object.keys(cells).filter((k) => cells[k].startsWith("="));
  const deps = new Map<string, string[]>();
  for (const key of formulas) {
    deps.set(key, referencedCells(cells[key].slice(1)).filter((r) => r !== key && cells[r]?.startsWith("=")));
  }
  const done = new Set<string>();
  const onPath = new Set<string>();
  const order: string[] = [];
  for (const root of formulas) {
    if (done.has(root)) continue;
    const stack: [string, number][] = [[root, 0]];
    onPath.add(root);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = deps.get(frame[0]) ?? [];
      if (frame[1] < children.length) {
        const child = children[frame[1]++];
        if (!done.has(child) && !onPath.has(child)) {
          onPath.add(child);
          stack.push([child, 0]);
        }
      } else {
        stack.pop();
        onPath.delete(frame[0]);
        done.add(frame[0]);
        order.push(frame[0]);
      }
    }
  }
  return order;
}

/** Trim float noise (0.1 + 0.2) without truncating genuine precision. */
function display(n: number): number {
  return Math.abs(n - Math.round(n)) < 1e-10 ? Math.round(n) : Number(n.toFixed(10));
}

/**
 * Evaluate a whole sheet once, and look cells up afterwards.
 *
 * The grid used to call evaluateCell for every cell, and each call resolved its
 * dependencies from scratch. A running-total column is a chain, so rendering it
 * was quadratic — measured at 13ms for 100 rows, 278ms for 500, 1.1 seconds for
 * 1000, on every render, which the grid does on each arrow key — and past 1342
 * rows the recursion overflowed and showed #ERROR!. Here every formula is
 * evaluated exactly once, in dependency order, so each reads its inputs from
 * the memo: linear in the size of the sheet, and shallow however long the chain.
 */
export function createEvaluator(cells: Record<string, string>): (ref: string) => CellValue {
  const ctx: EvalContext = { cells, memo: new Map(), visiting: new Set() };
  for (const key of evaluationOrder(cells)) {
    try { readCell(key, ctx); } catch { /* recorded in the memo */ }
  }
  return (ref: string): CellValue => {
    const key = ref.toUpperCase();
    const raw = cells[key];
    if (raw === undefined || raw === "") return "";
    if (!raw.startsWith("=")) return raw;
    let result = ctx.memo.get(key);
    if (result === undefined) {
      // Not reached for a formula in the cell map, but stays correct anyway.
      try { readCell(key, ctx); } catch { /* recorded */ }
      result = ctx.memo.get(key);
    }
    if (result === undefined) return "#ERROR!";
    return typeof result === "number" ? display(result) : result.error;
  };
}

/**
 * Display value for one cell: formulas evaluated, everything else verbatim.
 * Evaluating several cells? Build one createEvaluator and reuse it — calling
 * this per cell repeats the whole pass each time.
 */
export function evaluateCell(ref: string, cells: Record<string, string>): CellValue {
  return createEvaluator(cells)(ref);
}

/** True when the cell should render right-aligned (numeric or a numeric formula). */
export function isNumericCell(ref: string, cells: Record<string, string>): boolean {
  const v = evaluateCell(ref, cells);
  return typeof v === "number";
}

/* ── Ranges, copy and paste ───────────────────────────────────────── */

export interface CellPos { row: number; col: number }

export interface Range {
  r0: number; c0: number; r1: number; c1: number;
}

/**
 * Order two corners into a rectangle.
 *
 * Selections are made from an anchor to wherever the pointer or the arrow keys
 * ended up, which is just as often up and to the left. Everything downstream
 * assumes r0 <= r1 and c0 <= c1, so the ordering happens once, here.
 */
export function normalizeRange(a: CellPos, b: CellPos): Range {
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  };
}

export function rangeContains(range: Range, row: number, col: number): boolean {
  return row >= range.r0 && row <= range.r1 && col >= range.c0 && col <= range.c1;
}

export function rangeSize(range: Range): number {
  return (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
}

/** Every ref in a range, row-major. */
export function rangeRefs(range: Range): string[] {
  const out: string[] = [];
  for (let r = range.r0; r <= range.r1; r++)
    for (let c = range.c0; c <= range.c1; c++) out.push(cellRef(r, c));
  return out;
}

/**
 * A range as tab-separated text — what every spreadsheet puts on the clipboard.
 *
 * Evaluated values, not formulas: pasting into a mail or a document should give
 * the numbers a person can read, which is what they were looking at. Copying
 * within milindCal keeps formulas by reading the cell map directly instead.
 */
export function rangeToTSV(range: Range, cells: Record<string, string>): string {
  const evaluate = createEvaluator(cells);
  const rows: string[] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row: string[] = [];
    for (let c = range.c0; c <= range.c1; c++) {
      const v = evaluate(cellRef(r, c));
      row.push(String(v));
    }
    rows.push(row.join("\t"));
  }
  return rows.join("\n");
}

/** The same range as raw text, so a copy inside milindCal keeps its formulas. */
export function rangeToRaw(range: Range, cells: Record<string, string>): string[][] {
  const rows: string[][] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row: string[] = [];
    for (let c = range.c0; c <= range.c1; c++) row.push(cells[cellRef(r, c)] ?? "");
    rows.push(row);
  }
  return rows;
}

/**
 * Parse pasted text into a grid.
 *
 * Accepts what a spreadsheet or a text editor actually puts on a clipboard:
 * tabs between columns, and CRLF, LF or CR between rows. A trailing newline is
 * dropped so "a\nb\n" pastes two rows, not three.
 */
export function parseTSV(text: string): string[][] {
  const trimmed = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (trimmed === "") return [[""]];
  return trimmed.split("\n").map((line) => line.split("\t"));
}

/**
 * Write a grid of values starting at one cell.
 *
 * Returns a new cell map. Empty strings delete rather than store, so pasting a
 * block with gaps clears those cells instead of leaving stale values behind and
 * keeps the map sparse.
 */
export function pasteAt(
  cells: Record<string, string>,
  at: CellPos,
  grid: readonly (readonly string[])[],
): Record<string, string> {
  const next = { ...cells };
  grid.forEach((row, dr) => {
    row.forEach((value, dc) => {
      const ref = cellRef(at.row + dr, at.col + dc);
      if (value === "") delete next[ref];
      else next[ref] = value;
    });
  });
  return next;
}

/** Clear every cell in a range, keeping the map sparse. */
export function clearRange(cells: Record<string, string>, range: Range): Record<string, string> {
  const next = { ...cells };
  for (const ref of rangeRefs(range)) delete next[ref];
  return next;
}

/* ── Undo history ─────────────────────────────────────────────────── */

export interface History<T> {
  /** States before the present one, oldest first. */
  past: readonly T[];
  /** States undone out of, nearest first, discarded by the next fresh edit. */
  future: readonly T[];
}

export const EMPTY_HISTORY: History<never> = { past: [], future: [] };

/** How many steps back a sheet remembers. Snapshots are whole cell maps, so
 *  this is a memory bound as much as a usability one. */
export const HISTORY_LIMIT = 60;

/**
 * Record the state being replaced.
 *
 * The future is dropped: editing after undoing forks the timeline, and the
 * branch that was undone out of is no longer reachable. Every editor behaves
 * this way and users rely on it — a redo that resurrects unrelated work is
 * worse than no redo.
 */
export function pushHistory<T>(history: History<T>, replaced: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...history.past, replaced];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/**
 * Step back. Returns null when there is nothing to undo, so the caller can
 * leave the event alone rather than committing an identical state.
 */
export function undoHistory<T>(history: History<T>, present: T): { history: History<T>; value: T } | null {
  if (history.past.length === 0) return null;
  const value = history.past[history.past.length - 1];
  return {
    history: { past: history.past.slice(0, -1), future: [present, ...history.future] },
    value,
  };
}

/** Step forward again, undoing an undo. */
export function redoHistory<T>(history: History<T>, present: T): { history: History<T>; value: T } | null {
  if (history.future.length === 0) return null;
  const value = history.future[0];
  return {
    history: { past: [...history.past, present], future: history.future.slice(1) },
    value,
  };
}

/* ── Fill ─────────────────────────────────────────────────────────── */

/**
 * Rewrite the A1 references in a formula by a row/column offset.
 *
 * This is what makes filling a formula down useful rather than a copy: =A2*2
 * dragged one row becomes =A3*2. Function names are untouched because the
 * pattern requires digits after the letters, so SUM( never matches, and a ref
 * pushed off the grid becomes #REF! the way a spreadsheet does rather than
 * silently wrapping to the other side.
 */
export function shiftFormula(text: string, dRow: number, dCol: number): string {
  if (!text.startsWith("=")) return text;
  return (
    "=" +
    text.slice(1).replace(/\b([A-Za-z]+)(\d+)\b/g, (whole, letters: string, digits: string) => {
      const col = columnIndex(letters.toUpperCase());
      if (col < 0) return whole; // not a column name
      const row = Number.parseInt(digits, 10) - 1;
      const nextCol = col + dCol;
      const nextRow = row + dRow;
      if (nextCol < 0 || nextRow < 0) return "#REF!";
      return cellRef(nextRow, nextCol);
    })
  );
}

/**
 * The step of an arithmetic series, or null when the values are not one.
 *
 * Two or more numbers with a constant difference extend as a series; anything
 * else repeats. A single value has no step by definition — Excel would guess,
 * and guessing wrong on one cell is more annoying than simply repeating.
 */
export function seriesStep(values: readonly string[]): number | null {
  if (values.length < 2) return null;
  const nums = values.map((v) => (v.trim() === "" ? NaN : Number(v)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const step = nums[1] - nums[0];
  for (let i = 2; i < nums.length; i++) {
    if (Math.abs(nums[i] - nums[i - 1] - step) > 1e-9) return null;
  }
  return step;
}

/**
 * Extend a run of values to `count` entries.
 *
 * Numbers with a constant step continue it. Formulas are shifted by how far
 * they have travelled. Everything else — text, lone numbers, mixed content —
 * repeats in order, which is what a spreadsheet does and what people expect
 * when they drag a label down a column.
 */
export function fillValues(
  source: readonly string[],
  count: number,
  axis: "row" | "col" = "row",
): string[] {
  if (source.length === 0 || count <= 0) return [];
  const step = seriesStep(source);
  const out: string[] = [];
  const last = step === null ? 0 : Number(source[source.length - 1]);

  for (let i = 0; i < count; i++) {
    const from = source[i % source.length];
    if (step !== null) {
      out.push(String(last + step * (i + 1)));
      continue;
    }
    if (from.startsWith("=")) {
      // How far this copy sits from the cell it came from.
      const travelled = Math.floor(i / source.length) + 1;
      const shift = travelled * source.length;
      out.push(shiftFormula(from, axis === "row" ? shift : 0, axis === "col" ? shift : 0));
      continue;
    }
    out.push(from);
  }
  return out;
}
