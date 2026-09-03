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

export function SheetView({ title, sheet, onChange }: SheetViewProps) {
  const data = sheet ?? DEFAULT_SHEET;
  const [sel, setSel] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formulaRef = useRef<HTMLInputElement>(null);

  const activeRef = cellRef(sel.row, sel.col);
  const rawActive = data.cells[activeRef] ?? "";

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
      gridRef.current?.focus();
    },
    [activeRef, setCell, data.rows, data.cols],
  );

  const beginEdit = useCallback((seed?: string) => {
    setDraft(seed ?? data.cells[activeRef] ?? "");
    setEditing(activeRef);
  }, [activeRef, data.cells]);

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
      if (key === "Enter") { e.preventDefault(); return beginEdit(); }
      if (key === "F2") { e.preventDefault(); return beginEdit(); }
      if (key === "Delete" || key === "Backspace") { e.preventDefault(); return setCell(activeRef, ""); }
      if (key === "Home") { e.preventDefault(); return setSel((s) => ({ ...s, col: 0 })); }
      if (key === "End") { e.preventDefault(); return setSel((s) => ({ ...s, col: data.cols - 1 })); }

      // Any printable character starts an edit with that character — the
      // type-to-replace behaviour every spreadsheet has.
      if (key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        beginEdit(key);
      }
    },
    [editing, data.rows, data.cols, beginEdit, setCell, activeRef],
  );

  const onCellInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value, "down"); }
      else if (e.key === "Tab") { e.preventDefault(); commit(e.currentTarget.value, "right"); }
      else if (e.key === "Escape") { e.preventDefault(); setEditing(null); gridRef.current?.focus(); }
    },
    [commit],
  );

  /* Only the visible extent is rendered; cells outside it still exist in the
   * map and still evaluate, so the grid size is presentation only. */
  const rows = useMemo(() => Array.from({ length: data.rows }, (_, i) => i), [data.rows]);
  const cols = useMemo(() => Array.from({ length: data.cols }, (_, i) => i), [data.cols]);

  const gridTemplate = useMemo(
    () => `${HEADER_W}px ${cols.map((c) => `${colWidth(c)}px`).join(" ")}`,
    [cols, colWidth],
  );

  return (
    <div className="sheet">
      <div className="sheet__bar">
        <span className="sheet__ref" aria-live="off">{activeRef}</span>
        <input
          aria-label={`Formula for cell ${activeRef}`}
          className="sheet__formula"
          onChange={(e) => setCell(activeRef, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gridRef.current?.focus(); } }}
          placeholder="Value or =formula"
          ref={formulaRef}
          value={rawActive}
        />
      </div>

      <div
        aria-label={`${title} spreadsheet`}
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
              className={`sheet__colhead${c === sel.col ? " is-active" : ""}`}
              key={c}
              role="columnheader"
            >
              {columnName(c)}
            </div>
          ))}
        </div>

        {rows.map((r) => (
          <div className="sheet__row" key={r} role="row" style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}>
            <div className={`sheet__rowhead${r === sel.row ? " is-active" : ""}`} role="rowheader">{r + 1}</div>
            {cols.map((c) => {
              const ref = cellRef(r, c);
              const isSel = r === sel.row && c === sel.col;
              const isEditing = editing === ref;
              const value = evaluateCell(ref, data.cells);
              const isError = typeof value === "string" && value.startsWith("#");
              return (
                <div
                  aria-selected={isSel}
                  className={
                    "sheet__cell" +
                    (isSel ? " is-selected" : "") +
                    (typeof value === "number" ? " is-num" : "") +
                    (isError ? " is-error" : "")
                  }
                  key={c}
                  onDoubleClick={() => { setSel({ row: r, col: c }); beginEdit(); }}
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
          </div>
        ))}
      </div>
    </div>
  );
}
