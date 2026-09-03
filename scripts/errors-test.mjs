/**
 * The status pill is the only thing a user sees when sync breaks, so the text
 * it shows is the whole of the recovery instruction. These pin the mapping so
 * a future refactor can't quietly put "Unauthorized" back in front of someone.
 */
import { humanizeError } from '../lib/errors.ts';

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
};

const NET  = "Can't reach Google right now — check your connection.";
const AUTH = 'Your Google session has expired. Sign out and back in to reconnect.';
const FORB = 'Google refused that request — the account may not have permission.';
const RATE = 'Google is rate-limiting requests. Try again in a moment.';

// Network: the wording differs per browser, so the shape has to carry it.
t('TypeError (any wording)',      humanizeError(new TypeError('whatever'), 'fb'), NET);
t('Chrome "Failed to fetch"',     humanizeError(new Error('Failed to fetch'), 'fb'), NET);
t('Firefox "NetworkError"',       humanizeError(new Error('NetworkError when attempting to fetch'), 'fb'), NET);
t('Safari "Load failed"',         humanizeError(new Error('Load failed'), 'fb'), NET);

// Auth
t('bare "Unauthorized"',          humanizeError(new Error('Unauthorized'), 'fb'), AUTH);
t('"unauthorized" any case',      humanizeError(new Error('  unauthorized '), 'fb'), AUTH);
t('a 401 mentioned in text',      humanizeError(new Error('Request failed with 401'), 'fb'), AUTH);
t('"Forbidden"',                  humanizeError(new Error('Forbidden'), 'fb'), FORB);
t('a 403 mentioned in text',      humanizeError(new Error('got 403 back'), 'fb'), FORB);
t('rate limiting',                humanizeError(new Error('Calendar usage limits exceeded'), 'fb'), RATE);
t('a 429',                        humanizeError(new Error('429 Too Many Requests'), 'fb'), RATE);

// Anything specific from Google beats a generic substitute — pass it through.
t('unrecognised message survives', humanizeError(new Error('Invalid time range'), 'fb'), 'Invalid time range');
t('non-Error falls back',          humanizeError('a bare string', 'fallback text'), 'fallback text');
t('empty message falls back',      humanizeError(new Error(''), 'fallback text'), 'fallback text');
t('null falls back',               humanizeError(null, 'fallback text'), 'fallback text');

// Guard against over-matching: "401" inside a word is not a status code.
t('does not match 4010 as 401',    humanizeError(new Error('event 4010 missing'), 'fb'), 'event 4010 missing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
