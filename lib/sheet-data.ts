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
