import { evaluateCell, createEvaluator, columnName, columnIndex, cellRef, parseRef } from '../lib/sheet.ts';
const cells = {
  A1:'10', A2:'20', A3:'30', A4:'', A5:'text',
  B1:'=A1+A2', B2:'=SUM(A1:A3)', B3:'=AVERAGE(A1:A3)', B4:'=A1*2+5',
  B5:'=MAX(A1:A3)', B6:'=MIN(A1:A3)', B7:'=COUNT(A1:A3)',
  C1:'=A1/0', C2:'=C3', C3:'=C2', C4:'=NOPE(1)', C5:'=(A1+A2)*2',
  C6:'=A1+A5', C7:'=2^3', C8:'=-A1', C9:'=ROUND(3.14159,2)', C10:'=A1:A3',
  D1:'plain', D2:'=SUM(A1:A3)/COUNT(A1:A3)',
};
const T=[
  ['B1','A1+A2',30],['B2','SUM range',60],['B3','AVERAGE',20],['B4','precedence',25],
  ['B5','MAX',30],['B6','MIN',10],['B7','COUNT',3],
  ['C1','div by zero','#DIV/0!'],['C2','cycle','#CYCLE!'],['C4','unknown fn','#NAME?'],
  ['C5','parens',60],['C6','text in arithmetic is #VALUE!, as in Excel and Sheets','#VALUE!'],['C7','power',8],['C8','unary minus',-10],
  ['C9','ROUND 2dp',3.14],['C10','bare range sums',60],
  ['D1','plain text','plain'],['D2','nested fns',20],['A5','raw text','text'],['A4','empty',''],
];
let pass=0, fail=0;
for (const [ref,label,want] of T) {
  const got = evaluateCell(ref, cells);
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok?'✓':'✗'} ${ref.padEnd(4)} ${label.padEnd(18)} got=${JSON.stringify(got).padEnd(12)} want=${JSON.stringify(want)}`);
}
// A1 notation round-trip
const nameT = [[0,'A'],[25,'Z'],[26,'AA'],[27,'AB'],[51,'AZ'],[52,'BA']];
for (const [i,n] of nameT) {
  const ok = columnName(i)===n && columnIndex(n)===i;
  ok?pass++:fail++;
  console.log(`${ok?'✓':'✗'} col ${i} <-> ${n}`);
}
const pr = parseRef('AA12');
const okp = pr && pr.col===26 && pr.row===11 && cellRef(11,26)==='AA12';
okp?pass++:fail++;
console.log(`${okp?'✓':'✗'} parseRef/cellRef round-trip AA12`);

/* ── Blanks and text are not zeros ────────────────────────────────── */
{
  const ev = (cells, ref) => evaluateCell(ref, cells);
  const t2 = (label, got, want) => {
    const ok = got === want; ok ? pass++ : fail++;
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  };
  t2('AVERAGE skips a blank', ev({ A1: '2', A3: '4', B1: '=AVERAGE(A1:A3)' }, 'B1'), 3);
  t2('AVERAGE skips text', ev({ A1: '2', A2: 'x', A3: '4', B1: '=AVERAGE(A1:A3)' }, 'B1'), 3);
  t2('AVERAGE of a blank direct reference skips it', ev({ A1: '6', B1: '=AVERAGE(A1, A2)' }, 'B1'), 6);
  t2('AVERAGE of nothing is #DIV/0!', ev({ B1: '=AVERAGE(A1:A3)' }, 'B1'), '#DIV/0!');
  t2('COUNT counts numbers only', ev({ A1: '2', A2: 'x', B1: '=COUNT(A1:A3)' }, 'B1'), 1);
  t2('COUNT counts formula results', ev({ A1: '=1+1', A2: '3', B1: '=COUNT(A1:A2)' }, 'B1'), 2);
  t2('MIN skips a blank', ev({ A1: '5', A3: '7', B1: '=MIN(A1:A3)' }, 'B1'), 5);
  t2('MAX skips a blank among negatives', ev({ A1: '-5', A3: '-7', B1: '=MAX(A1:A3)' }, 'B1'), -5);
  t2('SUM still skips text', ev({ A1: '1', A2: 'x', A3: '3', B1: '=SUM(A1:A3)' }, 'B1'), 4);
  t2('a blank in arithmetic is still 0', ev({ A1: '5', B1: '=A1+A2' }, 'B1'), 5);
  t2('an error inside a range still propagates', ev({ A1: '=1/0', A2: '2', B1: '=SUM(A1:A2)' }, 'B1'), '#DIV/0!');
  // COUNT is the exception: it counts numbers, and an error is not one.
  t2('COUNT skips an error in its range, as Excel and Sheets do', ev({ A1: '=1/0', A2: '2', A3: '3', B1: '=COUNT(A1:A3)' }, 'B1'), 2);
  t2('MAX still propagates an error in its range', ev({ A1: '=1/0', A2: '2', B1: '=MAX(A1:A2)' }, 'B1'), '#DIV/0!');
  t2('a cell of spaces is blank, not zero', ev({ A1: '4', A2: '   ', B1: '=AVERAGE(A1:A2)' }, 'B1'), 4);
}

/* ── Long chains: correct, and linear ─────────────────────────────── */
{
  const t2 = (label, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : '  ' + detail}`); };
  // A running total down a long column — the most common long chain there is.
  const up = { A1: '1' };
  for (let i = 2; i <= 5000; i++) up[`A${i}`] = `=A${i - 1}+1`;
  t2('a 5000-row chain evaluates (it overflowed past 1342)', evaluateCell('A5000', up) === 5000, String(evaluateCell('A5000', up)));
  // The same chain pointing the other way, which ordering has to handle too.
  const down = { A5000: '1' };
  for (let i = 4999; i >= 1; i--) down[`A${i}`] = `=A${i + 1}+1`;
  t2('a 5000-row chain referencing downward evaluates', evaluateCell('A1', down) === 5000, String(evaluateCell('A1', down)));

  // Rendering every cell of a 1000-row running total was 1.1 s. With one
  // evaluator per pass it is linear; 100 ms is a generous ceiling for a
  // test runner, far above what it takes and far below what it was.
  const n = 1000;
  const cells = { A1: '1' };
  for (let i = 2; i <= n; i++) cells[`A${i}`] = `=A${i - 1}+A1`;
  const t0 = performance.now();
  const evaluate = createEvaluator(cells);
  let last;
  for (let i = 1; i <= n; i++) last = evaluate(`A${i}`);
  const ms = performance.now() - t0;
  t2(`rendering a ${n}-row running total takes ${ms.toFixed(1)} ms (was 1116 ms)`, ms < 100 && last === n, `${ms.toFixed(1)} ms, last=${last}`);

  // Cycles are still cycles, however the order was worked out.
  t2('a long cycle is still #CYCLE!', createEvaluator({ A1: '=A3', A2: '=A1', A3: '=A2' })('A2') === '#CYCLE!', '');
  t2('a cell that only reads a cycle reports it', createEvaluator({ A1: '=A2', A2: '=A1', B1: '=A1+1' })('B1') === '#CYCLE!', '');
  t2('a cell beside a cycle is unaffected', createEvaluator({ A1: '=A2', A2: '=A1', C1: '=2*3' })('C1') === 6, '');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
