/**
 * User-facing error text.
 *
 * Every failure path in the workspace used to surface `error.message`
 * directly, so the status pill would read "Unauthorized" — protocol
 * vocabulary that tells the reader nothing about what to do next.
 *
 * This only rewrites the cases where the raw text is actively unhelpful. A
 * specific message from Google ("Calendar usage limits exceeded for this
 * project") is more useful than any generic sentence we could substitute, so
 * anything unrecognised passes through unchanged.
 */
export function humanizeError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : "";

  // A rejected fetch — offline, DNS failure, connection reset — throws a
  // TypeError whose wording differs across browsers ("Failed to fetch" in
  // Chrome, "NetworkError..." in Firefox, "Load failed" in Safari), so match
  // the shape as well as the words.
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Can't reach Google right now — check your connection.";
  }
  if (/^unauthorized$/i.test(raw.trim()) || /\b401\b/.test(raw)) {
    return "Your Google session has expired. Sign out and back in to reconnect.";
  }
  if (/^forbidden$/i.test(raw.trim()) || /\b403\b/.test(raw)) {
    return "Google refused that request — the account may not have permission.";
  }
  if (/\b429\b|rate limit|usage limits/i.test(raw)) {
    return "Google is rate-limiting requests. Try again in a moment.";
  }
  return raw || fallback;
}
