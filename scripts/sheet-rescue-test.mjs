// Exercise the rescue's precedence rules in isolation: server wins when it
// has a value, local fills only a genuine gap, and a delete forgets.
const store = {};
const read = () => ({ ...store });
const write = (id, sheet) => {
  if (sheet === undefined || sheet === null) { delete store[id]; return; }
  store[id] = sheet;
};
const restore = (records) => {
  const rescue = read();
  return records.map(r => (r.sheet !== undefined || rescue[r.id] === undefined)
    ? r : { ...r, sheet: rescue[r.id] });
};

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n    got ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

const CELLS = { cells: { A1: '7' }, rows: 8, cols: 4 };
const SERVER = { cells: { A1: '99' }, rows: 8, cols: 4 };

write('r1', CELLS);
t('server dropped it → local fills the gap',
  restore([{ id: 'r1' }])[0].sheet, CELLS);

t('server HAS a sheet → server wins, local ignored',
  restore([{ id: 'r1', sheet: SERVER }])[0].sheet, SERVER);

t('unrelated record untouched',
  restore([{ id: 'other' }])[0].sheet, undefined);

write('r1', undefined);
t('cleared sheet does not resurrect',
  restore([{ id: 'r1' }])[0].sheet, undefined);

write('r2', CELLS);
write('r2', { cells: { A1: '8' }, rows: 8, cols: 4 });
t('later write replaces earlier',
  restore([{ id: 'r2' }])[0].sheet.cells.A1, '8');

// An empty sheet is still a sheet — must not be treated as absent.
write('r3', { cells: {}, rows: 8, cols: 4 });
t('empty grid is preserved, not dropped',
  restore([{ id: 'r3' }])[0].sheet, { cells: {}, rows: 8, cols: 4 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
