/**
 * The date strings this app has to produce exactly.
 *
 * Two audiences that want opposite things. `<input type="datetime-local">` and
 * `<input type="date">` want the user's *local* wall clock written out in a
 * fixed shape. An RRULE `UNTIL` wants a *UTC* instant.
 *
 * These were all one date-fns `format` call, and `format` always reads local
 * clock parts — correct for the inputs, and quietly wrong for `UNTIL`, where it
 * printed local time under a `Z` suffix. East of UTC that pushed a recurrence's
 * end date a whole day later every time the event was reopened; west of it, the
 * last occurrence could be dropped. See scripts/datetime-test.mjs.
 */

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * Parse an ISO string the way date-fns `parseISO` did: a bare `YYYY-MM-DD` is
 * *local* midnight, not UTC midnight. `new Date()` disagrees on exactly that
 * form, and Google returns a bare date for every all-day event, so the
 * difference shows up as an off-by-one day rather than as a nicety.
 */
function parseIsoLocal(value: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
}

/** `YYYY-MM-DD` from a date's local parts. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeLocal(isoValue: string) {
  if (!isoValue) return "";

  const date = parseIsoLocal(isoValue);
  return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateOnly(isoValue: string) {
  if (!isoValue) return "";

  return localDate(parseIsoLocal(isoValue));
}

/**
 * Shift a bare `YYYY-MM-DD` by whole days.
 *
 * Done in UTC deliberately. This is arithmetic on a calendar date with no clock
 * attached, and doing it through local midnight means the one day a year that
 * has no local midnight — DST transitions at 00:00, as Chile and parts of
 * Brazil have had — lands on a time that does not exist.
 */
function shiftDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function allDayEndToInclusive(endDate: string) {
  return shiftDays(endDate, -1);
}

export function allDayEndToExclusive(endDate: string) {
  return shiftDays(endDate, 1);
}

/**
 * The end of `dateValue` as a genuine UTC instant, in RRULE's basic format.
 *
 * The `Z` is a promise, so the parts have to be read with `getUTC*`. Reading
 * local parts instead is what produced `20260909T052959Z` in Asia/Kolkata for a
 * recurrence the user ended on 8 September — and the editor parses `UNTIL` back
 * out by slicing the first eight characters, so reopening the event showed them
 * a date they never picked.
 */
export function toUtcRruleDate(dateValue: string) {
  const date = new Date(`${dateValue}T23:59:59.000Z`);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
