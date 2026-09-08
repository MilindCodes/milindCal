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
  clearRange,
  columnName,
  fillValues,
  evaluateCell,
  EMPTY_HISTORY,
  normalizeRange,
  parseTSV,
  pasteAt,
  rangeContains,
  rangeSize,
  rangeToRaw,
  rangeToTSV,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
  type SheetData,
} from "@/lib/sheet";

interface SheetViewProps {
  title: string;
  sheet: SheetData;
  onChange: (next: SheetData) => void;
}

const DEFAULT_COL_WIDTH = 108;
/** Narrow enough to tuck a column away, wide enough to still grab its edge. */
const MIN_COL_WIDTH = 44;
const MAX_COL_WIDTH = 640;
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
  /* Column resizing. SheetData has carried colWidths from the start but
   * nothing could ever set it, so every sheet was stuck at one width for
   * every column — unusable for anything with a long label in it.
   *
   * The drag is held in a ref and mirrored into state: the ref is what the
   * pointer handlers read (they are attached once and would otherwise close
   * over a stale value), the state is what re-renders the grid. */
  /* Selection is an anchor plus a focus. The anchor is where the selection
   * started; the focus is where it now ends and is also the cell that types,
   * edits and the formula bar act on — the same split every spreadsheet uses. */
  const [anchor, setAnchor] = useState<{ row: number; col: number } | null>(null);
  const selectingRef = useRef(false);
  /* Filling. The handle at the selection's bottom-right corner extends the
   * values below or to the right of it. Kept separate from the selection drag
   * because they start on different elements and mean different things. */
  const fillingRef = useRef(false);
  const [fillTo, setFillTo] = useState<{ row: number; col: number } | null>(null);
  /* A copy made inside milindCal should paste back with its formulas intact,
   * but the clipboard only carries text. Keeping the raw grid alongside the
   * text we wrote lets a paste recognise its own copy and restore formulas,
   * while a paste from anywhere else still works as plain values. */
  const clipRef = useRef<{ text: string; raw: string[][] } | null>(null);
  /* Undo history. Kept in a ref rather than state because nothing renders
   * from it directly, and a re-render per keystroke to store a snapshot
   * nobody looks at is wasted work.
   *
   * Snapshots are whole SheetData values. A sheet is a sparse map, so a
   * snapshot is small, and diffing would be a lot of machinery to save bytes
   * that are already bounded by HISTORY_LIMIT. */
  const historyRef = useRef<History<SheetData>>(EMPTY_HISTORY);
  const resizeRef = useRef<{ col: number; startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState<{ col: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeRef = cellRef(sel.row, sel.col);
  const range = useMemo(() => normalizeRange(anchor ?? sel, sel), [anchor, sel]);
  const hasRange = rangeSize(range) > 1;
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
    // While dragging, the live width comes from the gesture rather than the
    // record, so the column follows the pointer without a write per pixel.
    (c: number) =>
      resizing?.col === c ? resizing.width : data.colWidths?.[c] ?? DEFAULT_COL_WIDTH,
    [data.colWidths, resizing],
  );

  /** The single write path. Recording here rather than at each call site is
   *  what stops a new mutation quietly being un-undoable. */
  const commitSheet = useCallback(
    (next: SheetData) => {
      historyRef.current = pushHistory(historyRef.current, data);
      onChange(next);
    },
    [data, onChange],
  );

  const undo = useCallback(() => {
    const step = undoHistory(historyRef.current, data);
    if (!step) return false;
    historyRef.current = step.history;
    onChange(step.value);
    return true;
  }, [data, onChange]);

  const redo = useCallback(() => {
    const step = redoHistory(historyRef.current, data);
    if (!step) return false;
    historyRef.current = step.history;
    onChange(step.value);
    return true;
  }, [data, onChange]);

  /**
   * Extend the selection's values to the cell the handle was dragged to.
   *
   * One axis at a time, whichever was dragged further — dragging diagonally
   * and getting a filled rectangle is never what was meant. Each column (or
   * row) is filled from its own values, so a two-column block keeps both
   * series rather than repeating the first.
   */
  const applyFill = useCallback(
    (target: { row: number; col: number }) => {
      const downBy = target.row - range.r1;
      const rightBy = target.col - range.c1;
      if (downBy <= 0 && rightBy <= 0) return;
      const vertical = downBy >= rightBy;
      const cells = { ...data.cells };
      const write = (ref: string, v: string) => {
        if (v === "") delete cells[ref];
        else cells[ref] = v;
      };

      if (vertical) {
        for (let c = range.c0; c <= range.c1; c++) {
          const source: string[] = [];
          for (let r = range.r0; r <= range.r1; r++) source.push(data.cells[cellRef(r, c)] ?? "");
          fillValues(source, downBy, "row").forEach((v, i) => write(cellRef(range.r1 + 1 + i, c), v));
        }
      } else {
        for (let r = range.r0; r <= range.r1; r++) {
          const source: string[] = [];
          for (let c = range.c0; c <= range.c1; c++) source.push(data.cells[cellRef(r, c)] ?? "");
          fillValues(source, rightBy, "col").forEach((v, i) => write(cellRef(r, range.c1 + 1 + i), v));
        }
      }
      commitSheet({ ...data, cells });
      // Leave the filled block selected, so a wrong guess is one undo or one
      // Delete away rather than something to hunt down.
      setAnchor({ row: range.r0, col: range.c0 });
      setSel(vertical ? { row: target.row, col: range.c1 } : { row: range.r1, col: target.col });
    },
    [data, range, commitSheet],
  );

  /** Write one cell. Empty input deletes the key so the map stays sparse. */
  const setCell = useCallback(
    (ref: string, value: string) => {
      const cells = { ...data.cells };
      if (value === "") delete cells[ref];
      else cells[ref] = value;
      commitSheet({ ...data, cells });
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

  // The release can land outside the grid, so the listener is on the window.
  useEffect(() => {
    const stop = () => {
      selectingRef.current = false;
      if (fillingRef.current) {
        fillingRef.current = false;
        setFillTo((t) => { if (t) applyFill(t); return null; });
      }
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [applyFill]);

  /* One write on release, not one per pointer move: each write rewrites the
   * localStorage mirror and PATCHes the whole sheet to milindDrive, which is
   * the same trap the formula bar was in. */
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const next = Math.round(
        Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, r.startWidth + (e.clientX - r.startX))),
      );
      setResizing({ col: r.col, width: next });
    };
    const onUp = () => {
      const r = resizeRef.current;
      const live = resizing;
      resizeRef.current = null;
      setResizing(null);
      if (!r || !live) return;
      const widths = { ...(data.colWidths ?? {}) };
      if (live.width === DEFAULT_COL_WIDTH) delete widths[r.col];
      else widths[r.col] = live.width;
      commitSheet({ ...data, colWidths: widths });
    };
    const onCancel = () => { resizeRef.current = null; setResizing(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [resizing, data, onChange]);

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
        // Shift keeps the anchor and moves the focus, growing the selection.
        // Without it the selection collapses back to a single cell.
        if (e.shiftKey) setAnchor((a) => a ?? { row: sel.row, col: sel.col });
        else setAnchor(null);
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
      if (key === "Delete" || key === "Backspace") {
        e.preventDefault();
        if (hasRange) return commitSheet({ ...data, cells: clearRange(data.cells, range) });
        return setCell(activeRef, "");
      }
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "z") {
        e.preventDefault();
        // Shift+Z redoes, matching every editor on both platforms.
        if (e.shiftKey) redo(); else undo();
        return;
      }
      // Ctrl+Y is the Windows redo and costs nothing to accept.
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      // Select the whole grid, the shortcut every grid has.
      if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "a") {
        e.preventDefault();
        setAnchor({ row: 0, col: 0 });
        return setSel({ row: data.rows - 1, col: data.cols - 1 });
      }
      if (key === "Home") { e.preventDefault(); return setSel((s) => ({ ...s, col: 0 })); }
      if (key === "End") { e.preventDefault(); return setSel((s) => ({ ...s, col: data.cols - 1 })); }

      // Any printable character starts an edit with that character — the
      // type-to-replace behaviour every spreadsheet has.
      if (key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        beginEdit(sel.row, sel.col, key);
      }
    },
    [editing, data, beginEdit, setCell, activeRef, sel.row, sel.col, hasRange, range, onChange],
  );

  const onCellInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value, "down"); }
      else if (e.key === "Tab") { e.preventDefault(); commit(e.currentTarget.value, "right"); }
      else if (e.key === "Escape") { e.preventDefault(); setEditing(null); gridRef.current?.focus(); }
    },
    [commit],
  );

  const onCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing) return; // let the cell editor handle its own text
      e.preventDefault();
      const text = rangeToTSV(range, data.cells);
      clipRef.current = { text, raw: rangeToRaw(range, data.cells) };
      e.clipboardData.setData("text/plain", text);
    },
    [editing, range, data.cells],
  );

  const onCut = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing) return;
      onCopy(e);
      commitSheet({ ...data, cells: clearRange(data.cells, range) });
    },
    [editing, onCopy, onChange, data, range],
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (editing) return;
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      // Our own copy: paste the raw cells so formulas survive the round trip.
      // Anything else is plain text and pastes as values.
      const grid = clipRef.current?.text === text ? clipRef.current.raw : parseTSV(text);
      commitSheet({ ...data, cells: pasteAt(data.cells, { row: sel.row, col: sel.col }, grid) });
      // Select what landed, which is what a spreadsheet does and makes an
      // accidental paste one Delete away from undone.
      const rows = grid.length;
      const cols = Math.max(...grid.map((r) => r.length));
      setAnchor({ row: sel.row, col: sel.col });
      setSel({
        row: Math.min(sel.row + rows - 1, data.rows - 1),
        col: Math.min(sel.col + cols - 1, data.cols - 1),
      });
    },
    [editing, data, onChange, sel.row, sel.col],
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
        onCopy={onCopy}
        onCut={onCut}
        onKeyDown={onGridKey}
        onPaste={onPaste}
        ref={gridRef}
        role="grid"
        tabIndex={0}
      >
        <div className="sheet__row sheet__row--head" style={{ gridTemplateColumns: gridTemplate }} role="row">
          <div className="sheet__corner" role="columnheader" aria-label="Select all" />
          {cols.map((c) => (
            <div
              aria-colindex={c + 1}
              className={
                `sheet__colhead${c === sel.col ? " is-active" : ""}` +
                (resizing?.col === c ? " is-resizing" : "")
              }
              key={c}
              role="columnheader"
            >
              {columnName(c)}
              {/* Grabbing the right edge sizes the column. Double-clicking it
                * returns the column to the default, which is the only way back
                * from a width dragged to the minimum. */}
              <span
                aria-hidden="true"
                className="sheet__colresize"
                onDoubleClick={() => {
                  const widths = { ...(data.colWidths ?? {}) };
                  delete widths[c];
                  commitSheet({ ...data, colWidths: widths });
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const startWidth = data.colWidths?.[c] ?? DEFAULT_COL_WIDTH;
                  resizeRef.current = { col: c, startX: e.clientX, startWidth };
                  setResizing({ col: c, width: startWidth });
                }}
              />
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
                    // Everything else inside a multi-cell selection.
                    (!isSel && hasRange && rangeContains(range, r, c) ? " is-inrange" : "") +
                    // Cells the fill would land on, shown before it commits.
                    (fillTo && !rangeContains(range, r, c) &&
                      r >= range.r0 && r <= Math.max(range.r1, fillTo.row) &&
                      c >= range.c0 && c <= Math.max(range.c1, fillTo.col)
                      ? " is-fillpreview" : "") +
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
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    gridRef.current?.focus();
                    if (e.shiftKey) {
                      // Extend from the existing anchor rather than starting over.
                      setAnchor((a) => a ?? { row: sel.row, col: sel.col });
                      setSel({ row: r, col: c });
                      return;
                    }
                    selectingRef.current = true;
                    setAnchor({ row: r, col: c });
                    setSel({ row: r, col: c });
                  }}
                  onPointerEnter={() => {
                    if (fillingRef.current) { setFillTo({ row: r, col: c }); return; }
                    if (selectingRef.current) setSel({ row: r, col: c });
                  }}
                  role="gridcell"
                >
                  {r === range.r1 && c === range.c1 && !isEditing ? (
                    <span
                      aria-hidden="true"
                      className="sheet__fill"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        e.stopPropagation();
                        fillingRef.current = true;
                        setFillTo({ row: r, col: c });
                      }}
                    />
                  ) : null}
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
