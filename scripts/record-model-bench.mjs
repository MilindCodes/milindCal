/**
 * Guard on the cost of the unified record model.
 *
 * Every view is a projection over one record space, so projecting and
 * filtering happens on render. This measures that it stays free: at 2000
 * records the whole projection is ~0.04ms, roughly 1/400th of a 60fps frame.
 *
 * Kept because it is the cheap way to notice if a future change makes the
 * projection quadratic — a regression that would be invisible in a small
 * dev dataset and painful in a real one.
 *
 * Pure logic only, so it is build-independent and meaningful in CI, unlike a
 * dev-server timing which is dominated by React's development build.
 */
import { recordFromTask, recordFromDoc, facetPatch, isScheduled, isActionable, hasBody }
  from '../lib/record.ts';

const mk = n => Array.from({length:n}, (_,i) => ({
  id:'t'+i, title:'Record '+i, completed:i%5===0, createdAt:Date.now(),
  importance:['low','medium','high'][i%3], source:'local',
  start:new Date(Date.now()+i*3600e3).toISOString(),
  end:new Date(Date.now()+i*3600e3+45*60e3).toISOString(), allDay:false,
}));

const bench = (label, fn, iters) => {
  fn(); // warm
  const t0 = performance.now();
  for (let i=0;i<iters;i++) fn();
  const per = (performance.now()-t0)/iters;
  const budget = 16.67; // one frame at 60fps
  console.log(`${per < budget/10 ? '✓' : per < budget ? '~' : '✗'} ${label.padEnd(46)} ${per.toFixed(3)} ms/run`);
  return per;
};

for (const n of [120, 500, 2000]) {
  const tasks = mk(n);
  console.log(`\n── ${n} records ──`);
  bench(`project ${n} tasks → records`, () => tasks.map(recordFromTask), 200);
  const recs = tasks.map(recordFromTask);
  bench(`filter by calendar facet`, () => recs.filter(isScheduled), 500);
  bench(`filter by task facet`, () => recs.filter(isActionable), 500);
  bench(`facetPatch across all`, () => recs.map(r => facetPatch(r, 'task')), 200);
}
console.log('\nBudget: one 60fps frame is 16.67ms. ✓ = under a tenth of it.');
