/**
 * Tests for the record model — the thing milindCal actually is.
 *
 * The whole architecture rests on one claim: a record's views follow from
 * which fields it carries, and a cross-view drag is a field write rather than
 * a copy. That claim is currently enforced by nothing. These assertions pin
 * it down so a later edit to facetPatch or the adapters can't quietly
 * reintroduce the duplication this design exists to remove.
 */
import {
  isScheduled, isActionable, hasBody, hasSheet, isDone, facetsOf,
  schedule, unschedule, makeActionable, ensureBody, ensureSheet, facetPatch,
  recordFromTask, taskFromRecord, recordFromDoc, docFromRecord, recordFromEvent,
} from '../lib/record.ts';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};

const base = (over = {}) => ({
  id: 'r1', title: 'A record', body: null,
  createdAt: 1, updatedAt: 1, affinity: 'task', links: [], ...over,
});

/* ── Facets are derived, not declared ─────────────────────────────── */
t('bare record has no facets', facetsOf(base()), []);
t('start ⇒ calendar', facetsOf(base({ start: '2026-01-01T09:00:00Z' })), ['calendar']);
t('status ⇒ task', facetsOf(base({ status: 'open' })), ['task']);
t('body ⇒ doc', facetsOf(base({ body: { type: 'doc' } })), ['doc']);
t('sheet ⇒ sheet', facetsOf(base({ sheet: { cells: {}, rows: 1, cols: 1 } })), ['sheet']);

// The central claim: facets are additive, not exclusive.
t('all four at once', facetsOf(base({
  start: 'x', status: 'open', body: { type: 'doc' }, sheet: { cells: {}, rows: 1, cols: 1 },
})), ['calendar', 'task', 'doc', 'sheet']);

t('isDone only when done', [isDone(base({ status: 'open' })), isDone(base({ status: 'done' }))], [false, true]);
t('hasBody false for null body', hasBody(base({ body: null })), false);

/* ── Transitions patch, never replace ─────────────────────────────── */
const sched = schedule('2026-03-01T10:00:00.000Z');
t('schedule defaults to +1h', sched.end, '2026-03-01T11:00:00.000Z');
t('schedule honours an explicit end', schedule('2026-03-01T10:00:00.000Z', '2026-03-01T12:00:00.000Z').end, '2026-03-01T12:00:00.000Z');
t('unschedule clears the window', [unschedule().start, unschedule().end], [undefined, undefined]);

// Dragging a finished task around must not quietly reopen it.
t('makeActionable preserves a done status', makeActionable(base({ status: 'done' })).status, 'done');
t('makeActionable opens an unstatused record', makeActionable(base()).status, 'open');
t('makeActionable keeps existing importance', makeActionable(base({ status: 'open', importance: 'high' })).importance, 'high');

// Idempotence: re-dropping something that already has the facet is a no-op,
// so a second drag can't clobber content.
t('ensureBody is a no-op when a body exists', ensureBody(base({ body: { type: 'doc' } })), {});
t('ensureSheet is a no-op when a sheet exists', ensureSheet(base({ sheet: { cells: { A1: '1' }, rows: 1, cols: 1 } })), {});
t('ensureBody seeds from the summary', ensureBody(base({ summary: 'hello' })).body,
  { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] });
t('ensureBody with no summary is empty, not null', ensureBody(base()).body, { type: 'doc', content: [] });

/* ── facetPatch routes to the right transition ────────────────────── */
t('drop on calendar sets a window', typeof facetPatch(base(), 'calendar', { start: '2026-05-05T08:00:00.000Z' }).start, 'string');
t('drop on task sets status', facetPatch(base(), 'task').status, 'open');
t('drop on task carries the column', facetPatch(base(), 'task', { columnId: 'doing' }).columnId, 'doing');
t('drop on doc gives a body', typeof facetPatch(base(), 'doc').body, 'object');
t('drop on sheet gives grid data', typeof facetPatch(base(), 'sheet').sheet, 'object');

// A drop that adds nothing must produce no write at all.
t('re-drop on doc is an empty patch', facetPatch(base({ body: { type: 'doc' } }), 'doc'), {});

/* ── Adapters round-trip ──────────────────────────────────────────── */
const task = {
  id: 't1', title: 'Ship it', description: 'notes', completed: false,
  createdAt: 5, importance: 'high', dueDate: '2026-04-01', columnId: 'doing', source: 'local',
};
const asRecord = recordFromTask(task);
t('task ⇒ record: open status', asRecord.status, 'open');
t('task ⇒ record: description becomes summary', asRecord.summary, 'notes');
t('record ⇒ task round-trips the title', taskFromRecord(asRecord).title, 'Ship it');
t('record ⇒ task round-trips completion', taskFromRecord(recordFromTask({ ...task, completed: true })).completed, true);
t('record ⇒ task round-trips importance', taskFromRecord(asRecord).importance, 'high');

/* Every facet a Task can carry must survive the projection. This block exists
 * because it didn't: `start` was added to Task and never mapped in
 * recordFromTask, so once the calendar started reading the record space,
 * every scheduled task silently vanished from the grid. Nothing caught it —
 * the app built, typechecked, linted and passed 39 assertions with an empty
 * calendar. Assert each facet crosses the boundary, in both directions. */
const scheduledTask = {
  id: 's1', title: 'Standup', completed: false, createdAt: 1, importance: 'medium',
  start: '2026-01-02T09:00:00.000Z', end: '2026-01-02T09:30:00.000Z', allDay: false,
};
const schedRec = recordFromTask(scheduledTask);
t('task ⇒ record carries start', schedRec.start, '2026-01-02T09:00:00.000Z');
t('task ⇒ record carries end', schedRec.end, '2026-01-02T09:30:00.000Z');
t('scheduled task IS on the calendar', isScheduled(schedRec), true);
t('scheduled task is still actionable', isActionable(schedRec), true);
t('record ⇒ task returns the window', [taskFromRecord(schedRec).start, taskFromRecord(schedRec).end],
  ['2026-01-02T09:00:00.000Z', '2026-01-02T09:30:00.000Z']);

// A task with a body is a doc too, and that has to cross the boundary.
const bodyTask = { id: 'b1', title: 'Has body', completed: false, createdAt: 1, importance: 'low',
  body: { type: 'doc', content: [] } };
t('task ⇒ record carries a body', hasBody(recordFromTask(bodyTask)), true);
t('record ⇒ task returns the body', taskFromRecord(recordFromTask(bodyTask)).body, { type: 'doc', content: [] });

// An adopted Google event: the record IS the event, so the projection must
// survive or the calendar would render Google's copy *and* the record.
const adopted = { id: 'a1', title: 'Adopted', completed: false, createdAt: 1, importance: 'medium',
  start: 'x', end: 'y', googleEventId: 'ev1', googleCalendarId: 'cal1' };
t('task ⇒ record keeps the Google projection', recordFromTask(adopted).google, { calendarId: 'cal1', eventId: 'ev1' });
t('record ⇒ task keeps googleEventId', taskFromRecord(recordFromTask(adopted)).googleEventId, 'ev1');

// A record with no completion state has no task facet at all — that is what
// keeps a sheet-only record off the board.
const sheetOnly = { id: 'x1', title: 'Sheet only', createdAt: 1 };
t('no completed ⇒ no task facet', isActionable(recordFromTask(sheetOnly)), false);
t('no completed round-trips as undefined', taskFromRecord(recordFromTask(sheetOnly)).completed, undefined);

const doc = { id: 'd1', title: 'Notes', content: { type: 'doc' }, createdAt: 2, updatedAt: 3, links: ['x'] };
t('doc ⇒ record keeps the body', hasBody(recordFromDoc(doc)), true);
t('doc ⇒ record keeps links', recordFromDoc(doc).links, ['x']);
t('record ⇒ doc round-trips the body', docFromRecord(recordFromDoc(doc)).content, { type: 'doc' });

// A doc converted from an event carried its schedule in calendarMeta; in the
// unified model that is simply the record's own start/end plus its projection.
const docWithMeta = {
  ...doc,
  calendarMeta: { eventId: 'e1', calendarId: 'c1', title: 'Notes', start: 's', end: 'e', allDay: false },
};
const metaRec = recordFromDoc(docWithMeta);
t('calendarMeta becomes a real schedule', [metaRec.start, metaRec.end], ['s', 'e']);
t('calendarMeta becomes a Google projection', metaRec.google, { calendarId: 'c1', eventId: 'e1' });
t('scheduled doc is on the calendar', isScheduled(metaRec), true);
t('round-trip restores calendarMeta', docFromRecord(metaRec).calendarMeta?.eventId, 'e1');

const event = {
  id: 'e1', calendarId: 'c1', title: 'Standup', description: 'd', location: 'l',
  start: 's', end: 'e', allDay: false, attendees: [], recurrence: [],
  reminders: { useDefault: true, overrides: [] }, eventType: 'meeting', color: '#fff', colorId: '9', etag: 'W/1',
};
const evRec = recordFromEvent(event);
t('event ⇒ record is scheduled', isScheduled(evRec), true);
t('event ⇒ record is not actionable', isActionable(evRec), false);
t('event ⇒ record keeps its etag', evRec.google?.etag, 'W/1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
