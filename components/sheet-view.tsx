"use client";

/**
 * The sheet facet's view.
 *
 * Renders a record that carries `sheet` data. Like every other view in
 * milindCal this is a projection, not a type: the same record can also have a
 * start time and a completion state, and it will show up on the calendar and
 * the board too.
 *
 * Editing model follows the convention every spreadsheet user already has:
 * click selects, typing replaces, Enter/Tab commit and advance, Escape
 * reverts, and the formula bar always shows the *raw* cell text while the grid
 * shows the evaluated result.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SHEET,
  cellRef,
  columnName,
  evaluateCell,
  type SheetData,
} from "@/lib/sheet";

interface SheetViewProps {
  title: string;
  sheet: SheetData;
  onChange: (next: SheetData) => void;
}

const DEFAULT_COL_WIDTH = 108;
const ROW_HEIGHT = 28;
const HEADER_W = 44;

/** DOM id for a cell, so the grid can point `aria-activedescendant` at it. */
const cellDomId = (ref: string) => `sheet-cell-${ref}`;

export function SheetView({ title, sheet, onChange }: SheetViewProps) {
  const data = sheet ?? DEFAULT_SHEET;
  const [sel, setSel] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeRef = cellRef(sel.row, sel.col);
  const rawActive = data.cells[activeRef] ?? "";

  /* The formula bar buffers its text instead of writing per keystroke.
   *
   * Every write runs the full store path — a localStorage mirror rewrite and a
   * PATCH to milindDrive carrying the whole sheet. Unbuffered, typing
   * "=SUM(A1:A10)" fired twelve of those, eleven of them for formulas that were
   * still half-typed and evaluated to #ERROR! in the grid as you went.
   *
   * Tagging the buffer with the ref it belongs to means moving the selection
   * discards it automatically — no effect needed to keep them in sync. */
  const [formulaEdit, setFormulaEdit] = useState<{ ref: string; text: string } | null>(null);
  /* Enter and Escape both move focus to the grid, which fires the bar’s blur
   * before React has re-rendered — so blur still sees the old buffer and would
   * commit it, defeating Escape entirely and double-writing on Enter. The key
   * handler records its intent here, synchronously, and blur defers to it. */
  const barActionRef = useRef<"commit" | "discard" | null>(null);
  const formulaValue = formulaEdit?.ref === activeRef ? formulaEdit.text : rawActive;

  const colWidth = useCallback(
    (c: number) => data.colWidths?.[c] ?? DEFAULT_COL_WIDTH,
    [data.colWidths],
  );

  /** Write one cell. Empty input deletes the key so the map stays sparse. */
  const setCell = useCallback(
    (ref: string, value: string) => {
      const cells = { ...data.cells };
      if (value === "") delete cells[ref];
      else cells[ref] = value;
      onChange({ ...data, cells });
    },
    [data, onChange],
  );

  const commit = useCallback(
    (value: string, advance: "down" | "right" | null) => {
      setCell(activeRef, value);
      setEditing(null);
      if (advance === "down") setSel((s) => ({ ...s, row: Math.min(s.row + 1, data.rows - 1) }));
      if (advance === "right") setSel((s) => ({ ...s, col: Math.min(s.col + 1, data.cols - 1) }));
      // Only pull focus back for a keyboard commit. Doing it on blur too would
      // snatch focus away from whatever the user just clicked — the formula bar
      // most of all, which is unusable if clicking into it bounces you out.
      if (advance !== null) gridRef.current?.focus();
    },
    [activeRef, setCell, data.rows, data.cols],
  );

  /* Coordinates are explicit rather than read from `sel`, because a click
   * handler that calls setSel cannot see the result in the same tick. It works
   * today only because onMouseDown lands first and flushes; passing the cell
   * directly removes that dependency on event ordering. */
  const beginEdit = useCallback(
    (row: number, col: number, seed?: string) => {
      const ref = cellRef(row, col);
      setDraft(seed ?? data.cells[ref] ?? "");
      setEditing(ref);
    },
    [data.cells],
  );

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  /* ── Grid keyboard model ──────────────────────────────────────────
   * Handled on the grid container rather than per-cell so arrow keys work
   * without every cell being a tab stop — 192 tab stops would make the sheet
   * impossible to tab past. */
  const onGridKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return;
      const { key } = e;

      const move = (dr: number, dc: number) => {
        e.preventDefault();
        setSel((s) => ({
          row: Math.max(0, Math.min(s.row + dr, data.rows - 1)),
          col: Math.max(0, Math.min(s.col + dc, data.cols - 1)),
        }));
      };

      if (key === "ArrowDown") return move(1, 0);
      if (key === "ArrowUp") return move(-1, 0);
      if (key === "ArrowRight") return move(0, 1);
      if (key === "ArrowLeft") return move(0, -1);
      if (key === "Tab") { e.preventDefault(); return move(0, e.shiftKey ? -1 : 1); }
      if (key === "Enter" || key === "F2") { e.preventDefault(); return beginEdit(sel.row, sel.col); }
      if (key === "Delete" || key === "Backspace") { e.preventDefault(); return setCell(activeRef, ""); }
      if (key === "Home") { e.preventDefault(); return setSel((s) => ({ ...s, col: 0 })); }
      if (key === "End") { e.preventDefault(); return setSel((s) => ({ ...s, col: data.cols - 1 })); }

      // Any printable character starts an edit with that character — the
      // type-to-replace behaviour every spreadsheet has.
      if (key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        beginEdit(sel.row, sel.col, key);
      }
    },
    [editing, data.rows, data.cols, beginEdit, setCell, activeRef, sel.row, sel.col],
  );

  const onCellInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value, "down"); }
      else if (e.key === "Tab") { e.preventDefault(); commit(e.currentTarget.value, "right"); }
      else if (e.key === "Escape") { e.preventDefault(); setEditing(null); gridRef.current?.focus(); }
    },
    [commit],
  );

  const onFormulaKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        barActionRef.current = "commit";
        setCell(activeRef, formulaValue);
        setFormulaEdit(null);
        gridRef.current?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        barActionRef.current = "discard";
        setFormulaEdit(null);
        gridRef.current?.focus();
      }
    },
    [activeRef, formulaValue, setCell],
  );

  /* Only the visible extent is rendered; cells outside it still exist in the
   * map and still evaluate, so the grid size is presentation only. */
  const rows = useMemo(() => Array.from({ length: data.rows }, (_, i) => i), [data.rows]);
  const cols = useMemo(() => Array.from({ length: data.cols }, (_, i) => i), [data.cols]);

  const gridTemplate = useMemo(
    // A trailing 1fr track carries the ruling to the edge of the pane. Without
    // it each row stops where its last column does and the remaining width is
    // unpainted, which reads as a broken layout rather than an empty sheet.
    () => `${HEADER_W}px ${cols.map((c) => `${colWidth(c)}px`).join(" ")} 1fr`,
    [cols, colWidth],
  );

  return (
    <div className="sheet">
      <div className="sheet__bar">
        <span className="sheet__ref">{activeRef}</span>
        <span aria-hidden="true" className="sheet__fx">fx</span>
        <input
          aria-label={`Formula for cell ${activeRef}`}
          className="sheet__formula"
          onBlur={() => {
            const handled = barActionRef.current;
            barActionRef.current = null;
            if (handled) return; // Enter committed, or Escape discarded.
            if (formulaEdit?.ref === activeRef) {
              setCell(activeRef, formulaEdit.text);
              setFormulaEdit(null);
            }
          }}
          onChange={(e) => setFormulaEdit({ ref: activeRef, text: e.target.value })}
          onKeyDown={onFormulaKey}
          placeholder="Value or =formula"
          value={formulaValue}
        />
      </div>

      {/* Announces the selection to screen readers, which otherwise get nothing
        * from arrow-key movement: focus never leaves the grid container. */}
      <span aria-live="polite" className="sr-only">
        {activeRef}
        {rawActive ? `, ${rawActive}` : ", empty"}
      </span>

      <div
        aria-activedescendant={cellDomId(activeRef)}
        aria-colcount={data.cols}
        aria-label={`${title} spreadsheet`}
        aria-rowcount={data.rows}
        className="sheet__grid"
        onKeyDown={onGridKey}
        ref={gridRef}
        role="grid"
        tabIndex={0}
      >
        <div className="sheet__row sheet__row--head" style={{ gridTemplateColumns: gridTemplate }} role="row">
          <div className="sheet__corner" role="columnheader" aria-label="Select all" />
          {cols.map((c) => (
            <div
              aria-colindex={c + 1}
              className={`sheet__colhead${c === sel.col ? " is-active" : ""}`}
              key={c}
              role="columnheader"
            >
              {columnName(c)}
            </div>
          ))}
          <div className="sheet__filler" />
        </div>

        {rows.map((r) => (
          <div
            aria-rowindex={r + 1}
            className="sheet__row"
            key={r}
            role="row"
            style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
          >
            <div className={`sheet__rowhead${r === sel.row ? " is-active" : ""}`} role="rowheader">{r + 1}</div>
            {cols.map((c) => {
              const ref = cellRef(r, c);
              const isSel = r === sel.row && c === sel.col;
              const isEditing = editing === ref;
              const value = evaluateCell(ref, data.cells);
              const isError = typeof value === "string" && value.startsWith("#");
              return (
                <div
                  aria-colindex={c + 1}
                  aria-selected={isSel}
                  className={
                    "sheet__cell" +
                    (isSel ? " is-selected" : "") +
                    // Crosshair: the row and column of the selection tint, so
                    // you can trace a cell back to its headers across a wide
                    // grid without counting.
                    (!isSel && (r === sel.row || c === sel.col) ? " is-axis" : "") +
                    (typeof value === "number" ? " is-num" : "") +
                    (isError ? " is-error" : "")
                  }
                  id={cellDomId(ref)}
                  key={c}
                  onDoubleClick={() => { setSel({ row: r, col: c }); beginEdit(r, c); }}
                  onMouseDown={() => { setSel({ row: r, col: c }); gridRef.current?.focus(); }}
                  role="gridcell"
                >
                  {isEditing ? (
                    <input
                      className="sheet__editor"
                      onBlur={(e) => commit(e.currentTarget.value, null)}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onCellInputKey}
                      ref={inputRef}
                      value={draft}
                    />
                  ) : (
                    <span className="sheet__value">{String(value)}</span>
                  )}
                </div>
              );
            })}
            <div className="sheet__filler" />
          </div>
        ))}
      </div>
    </div>
  );
}
