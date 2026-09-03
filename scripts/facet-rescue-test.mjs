/**
 * Precedence rules for the local facet rescue.
 *
 * The rescue exists because milindDrive drops several record fields on save.
 * Its correctness is entirely about precedence: the server must always win
 * where it has a value, the mirror must fill only genuine gaps, and a cleared
 * facet must stay cleared. Get that wrong and stale local data silently
 * overrides real server state — worse than the loss it was meant to prevent.
 */
const TASK_FIELDS = ['start','end','allDay','body','sheet','googleEventId','googleCalendarId'];
const DOC_FIELDS  = ['completed','importance','dueDate','columnId','sheet'];

let store = {};
const write = (id, patch, fields) => {
  const entry = { ...(store[id] ?? {}) };
  let touched = false;
  for (const f of fields) {
    if (!(f in patch)) continue;
    touched = true;
    const v = patch[f];
    if (v === undefined || v === null) delete entry[f]; else entry[f] = v;
  }
  if (!touched) return;
  if (Object.keys(entry).length === 0) delete store[id]; else store[id] = entry;
};
const forget = id => { delete store[id]; };
const restore = (records, fields) => records.map(r => {
  const entry = store[r.id];
  if (!entry) return r;
  const patch = {};
  for (const f of fields) if (entry[f] !== undefined && r[f] === undefined) patch[f] = entry[f];
  return Object.keys(patch).length ? { ...r, ...patch } : r;
});

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n    got ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

// Scheduling a task
write('t1', { start: '2026-03-01T09:00:00Z', end: '2026-03-01T10:00:00Z' }, TASK_FIELDS);
t('task schedule survives a server that drops it',
  restore([{ id: 't1' }], TASK_FIELDS)[0].start, '2026-03-01T09:00:00Z');

// The rule that matters most
t('server value always wins over the mirror',
  restore([{ id: 't1', start: 'SERVER' }], TASK_FIELDS)[0].start, 'SERVER');

// Google adoption
write('t2', { googleEventId: 'ev1', googleCalendarId: 'cal1' }, TASK_FIELDS);
t('adoption survives', restore([{ id: 't2' }], TASK_FIELDS)[0].googleEventId, 'ev1');

// Doc on the board
write('d1', { completed: false, importance: 'high' }, DOC_FIELDS);
t('doc board membership survives',
  restore([{ id: 'd1' }], DOC_FIELDS)[0].completed, false);
t('completed:false is a value, not an absence',
  'completed' in restore([{ id: 'd1' }], DOC_FIELDS)[0], true);

// Sheets
write('s1', { sheet: { cells: { A1: '7' }, rows: 8, cols: 4 } }, TASK_FIELDS);
t('sheet survives', restore([{ id: 's1' }], TASK_FIELDS)[0].sheet.cells.A1, '7');
write('s2', { sheet: { cells: {}, rows: 8, cols: 4 } }, TASK_FIELDS);
t('an empty grid is still a sheet',
  restore([{ id: 's2' }], TASK_FIELDS)[0].sheet, { cells: {}, rows: 8, cols: 4 });

// Clearing
write('t1', { start: null, end: null }, TASK_FIELDS);
t('unscheduling is not undone by the mirror',
  restore([{ id: 't1' }], TASK_FIELDS)[0].start, undefined);

// Field scoping — a doc must not pick up task-only fields
write('d2', { completed: true }, DOC_FIELDS);
t('doc restore ignores task-only fields',
  restore([{ id: 'd2' }], DOC_FIELDS)[0].start, undefined);

// Deletion
write('t3', { start: 'x' }, TASK_FIELDS);
forget('t3');
t('a deleted record leaves nothing behind',
  restore([{ id: 't3' }], TASK_FIELDS)[0].start, undefined);

// Untracked records are returned untouched
t('unknown record passes through',
  restore([{ id: 'never-seen' }], TASK_FIELDS)[0], { id: 'never-seen' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
