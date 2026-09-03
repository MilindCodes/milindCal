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

export interface SheetData {
  /** Sparse cell map keyed by A1 notation. Values are raw input — a formula
   *  is stored with its leading "=" and evaluated on read. */
  cells: Record<string, string>;
  /** Grid extent. Purely presentational: cells outside it are still stored
   *  and still evaluate, so shrinking the grid never destroys data. */
  rows: number;
  cols: number;
  /** Per-column widths in px, keyed by zero-based column index. */
  colWidths?: Record<number, number>;
}

export const DEFAULT_SHEET: SheetData = { cells: {}, rows: 24, cols: 8 };

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

const FUNCTIONS: Record<string, (xs: number[]) => number> = {
  SUM: (xs) => xs.reduce((a, b) => a + b, 0),
  AVERAGE: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0),
  AVG: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0),
  MIN: (xs) => (xs.length ? Math.min(...xs) : 0),
  MAX: (xs) => (xs.length ? Math.max(...xs) : 0),
  COUNT: (xs) => xs.length,
  PRODUCT: (xs) => xs.reduce((a, b) => a * b, 1),
  ROUND: (xs) => (xs.length ? Math.round(xs[0] * 10 ** (xs[1] ?? 0)) / 10 ** (xs[1] ?? 0) : 0),
  ABS: (xs) => Math.abs(xs[0] ?? 0),
};

/**
 * Recursive-descent evaluator over a small expression grammar:
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := factor (("*" | "/") factor)*
 *   factor  := "-"? primary ("^" factor)?
 *   primary := number | ref | range | call | "(" expr ")"
 *
 * `visiting` carries the chain of cells currently being resolved so a cycle
 * reports #CYCLE! rather than blowing the stack.
 */
function evaluateExpression(
  input: string,
  cells: Record<string, string>,
  visiting: Set<string>,
): number {
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

  /** Numeric value of one cell, resolving formulas recursively. */
  function refValue(ref: string): number {
    const key = ref.toUpperCase();
    if (visiting.has(key)) throw new Error("#CYCLE!");
    const raw = cells[key];
    if (raw === undefined || raw === "") return 0;
    if (raw.startsWith("=")) {
      visiting.add(key);
      try {
        return evaluateExpression(raw.slice(1), cells, visiting);
      } finally {
        visiting.delete(key);
      }
    }
    const n = Number(raw);
    // Text in an arithmetic context counts as zero, matching spreadsheet
    // convention — it should not poison the whole formula with NaN.
    return Number.isFinite(n) ? n : 0;
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
      const args: number[] = [];
      if (peek() !== ")") {
        for (;;) {
          args.push(...parseArg());
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
      // A bare range outside a function collapses to its sum.
      return refs.reduce((acc, r) => acc + refValue(r), 0);
    }

    if (!parseRef(ident)) throw new Error("#NAME?");
    return refValue(ident);
  }

  /** An argument may be a range, which contributes many values. */
  function parseArg(): number[] {
    skipWs();
    const save = pos;
    const m = /^([A-Za-z]+\d+)\s*:\s*([A-Za-z]+\d+)/.exec(src.slice(pos));
    if (m) {
      pos += m[0].length;
      const refs = expandRange(m[1], m[2]);
      if (!refs.length) throw new Error("#REF!");
      return refs.map(refValue);
    }
    pos = save;
    return [parseExpr()];
  }

  const result = parseExpr();
  skipWs();
  if (pos < src.length) throw new Error("#ERROR!");
  if (!Number.isFinite(result)) throw new Error("#NUM!");
  return result;
}

/** Display value for a cell: formulas evaluated, everything else verbatim. */
export function evaluateCell(ref: string, cells: Record<string, string>): CellValue {
  const raw = cells[ref.toUpperCase()];
  if (raw === undefined || raw === "") return "";
  if (!raw.startsWith("=")) return raw;
  try {
    const n = evaluateExpression(raw.slice(1), cells, new Set([ref.toUpperCase()]));
    // Trim float noise (0.1 + 0.2) without truncating genuine precision.
    return Math.abs(n - Math.round(n)) < 1e-10 ? Math.round(n) : Number(n.toFixed(10));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "#ERROR!";
    return msg.startsWith("#") ? msg : "#ERROR!";
  }
}

/** True when the cell should render right-aligned (numeric or a numeric formula). */
export function isNumericCell(ref: string, cells: Record<string, string>): boolean {
  const v = evaluateCell(ref, cells);
  return typeof v === "number";
}
