import { evaluateCell, columnName, columnIndex, cellRef, parseRef } from '../lib/sheet.ts';
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
  ['C5','parens',60],['C6','text as zero',10],['C7','power',8],['C8','unary minus',-10],
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
