import { createHash } from "node:crypto";
import { auth as calendarAuth, calendar } from "@googleapis/calendar";
import { auth as gmailAuth, gmail } from "@googleapis/gmail";
import { auth as peopleAuth, people } from "@googleapis/people";
import { EVENT_TYPE_BY_ID } from "@/lib/models";
import type { CalendarEvent, EventTypeId, GmailMessageDetail, GmailMessageSummary, GoogleEventPayload } from "@/lib/models";

const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127"
};

// Each modular @googleapis/* package bundles its own google-auth-library, so we
// build the OAuth2 client from each package's own `auth` export to keep the
// client and its auth type in the same realm (a shared google-auth-library
// would fail to typecheck against the nested copies).

export function getCalendarClient(accessToken: string) {
  const oauth = new calendarAuth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  return calendar({ version: "v3", auth: oauth });
}

export function getGmailClient(accessToken: string) {
  const oauth = new gmailAuth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  return gmail({ version: "v1", auth: oauth });
}

export function getPeopleClient(accessToken: string) {
  const oauth = new peopleAuth.OAuth2();
  oauth.setCredentials({ access_token: accessToken });
  return people({ version: "v1", auth: oauth });
}

/* ── Calendar-colour cache ──────────────────────────────────────────────
 *
 * The only thing a calendarList fetch contributes to the event routes is a
 * calendarId → backgroundColor map, and a user's calendar list changes very
 * rarely. Fetching it on every events request added a full Google round-trip
 * (~200ms) plus quota to every calendar navigation that missed the client
 * cache.
 *
 * Unlike the watch-state store — which deliberately refuses to cache because
 * stale reads there would clobber concurrent writes from other instances —
 * this is read-only derived data with a short TTL, so a per-instance cache is
 * safe: the worst case is a recoloured calendar taking up to TTL to show its
 * new colour.
 *
 * Keyed by a hash of the access token so two signed-in users on the same warm
 * container never share a map, and so the raw token isn't held as a map key.
 *
 * Shared by the list route and the single-event routes. The write routes used
 * to map Google's reply with no calendar colour at all, so an event that takes
 * its colour from its calendar came back blue after every save or move.
 */
const COLOR_CACHE_TTL_MS = 5 * 60 * 1000;
const COLOR_CACHE_MAX_ENTRIES = 50;

type ColorMap = Map<string, string>;
const colorCache = new Map<string, { colors: ColorMap; at: number }>();

function cacheKeyFor(accessToken: string) {
  return createHash("sha256").update(accessToken).digest("base64url").slice(0, 22);
}

/** Returns the calendarId → backgroundColor map, fetching it only on a miss.
 *  Never throws: colours are cosmetic, so a failure degrades to no colours
 *  rather than failing the whole request. */
export async function getCalendarColors(
  calendarClient: ReturnType<typeof getCalendarClient>,
  accessToken: string
): Promise<ColorMap> {
  const key = cacheKeyFor(accessToken);
  const now = Date.now();

  const hit = colorCache.get(key);
  if (hit && now - hit.at < COLOR_CACHE_TTL_MS) return hit.colors;

  try {
    const response = await calendarClient.calendarList.list({ minAccessRole: "reader" });
    const colors: ColorMap = new Map();
    for (const item of response.data.items ?? []) {
      if (!item.id) continue;
      colors.set(item.id, item.backgroundColor ?? "#4f8cff");
    }

    // Bound the map so a long-lived container can't accumulate entries for
    // every token it has ever seen. Oldest insertion goes first.
    if (colorCache.size >= COLOR_CACHE_MAX_ENTRIES) {
      const oldest = colorCache.keys().next().value;
      if (oldest !== undefined) colorCache.delete(oldest);
    }
    colorCache.set(key, { colors, at: now });
    return colors;
  } catch (err) {
    console.error("[events] calendarList fetch failed — rendering without calendar colours:", err);
    // Serve a stale map if we have one; otherwise fall back to per-event colours.
    return hit?.colors ?? new Map();
  }
}

/** The HTTP status a googleapis call failed with, if it says. */
export function googleErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = e.response?.status ?? e.status ?? e.code;
  return typeof status === "number" ? status : undefined;
}

/* ── Outgoing mail ──────────────────────────────────────────────────── */

/** Header values may not contain line breaks: one would end the header and
 *  let the rest of the value write headers of its own. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047: a header is 7-bit ASCII, so anything else travels encoded. A raw
 *  UTF-8 subject reaches some clients as mojibake. */
function encodeHeaderWord(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * A plain-text RFC 5322 message, ready to base64url for `messages.send`.
 *
 * The blank line between the headers and the body is the one part of this
 * format that is not optional, and both send paths used to lose it: they
 * built the lines as an array and ran `.filter(Boolean)` to drop the unused
 * Cc/Bcc slots, which dropped the empty separator with them. The body then
 * read as one more header line — "Re: tomorrow" became a header named "Re" —
 * and the mail went out empty or garbled. Optional headers are filtered here;
 * the separator is added after.
 */
export function buildRawEmail(headers: Array<[name: string, value: string | undefined]>, body: string): string {
  const lines = headers
    .filter(([, value]) => value !== undefined && value.trim() !== "")
    .map(([name, value]) => {
      const clean = headerValue(value as string);
      return `${name}: ${name.toLowerCase() === "subject" ? encodeHeaderWord(clean) : clean}`;
    });
  lines.push("Content-Type: text/plain; charset=UTF-8", "MIME-Version: 1.0");
  // CRLF line endings throughout, including inside the body.
  return `${lines.join("\r\n")}\r\n\r\n${body.replace(/\r?\n/g, "\r\n")}`;
}

function isEventTypeId(value: unknown): value is EventTypeId {
  return typeof value === "string" && value in EVENT_TYPE_BY_ID;
}

export function mapGoogleEventToClient(
  event: any,
  calendarId: string,
  calendarColor?: string
): CalendarEvent {
  const rawEventType = event.extendedProperties?.private?.eventType;
  const hasKnownEventType = isEventTypeId(rawEventType);
  const eventType: EventTypeId = hasKnownEventType ? rawEventType : "other";
  const eventTypeColor = hasKnownEventType ? EVENT_TYPE_BY_ID[eventType].color : undefined;
  const googleEventColor = typeof event.colorId === "string" ? GOOGLE_EVENT_COLORS[event.colorId] : undefined;
  const fallbackColor = eventTypeColor ?? googleEventColor ?? calendarColor ?? "#4f8cff";

  return {
    id: event.id,
    calendarId,
    title: event.summary?.trim() || "Untitled",
    description: event.description ?? "",
    location: event.location ?? "",
    start: event.start?.dateTime ?? event.start?.date,
    end: event.end?.dateTime ?? event.end?.date,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    attendees: (event.attendees ?? []).map((person: { email: string }) => person.email),
    recurrence: event.recurrence ?? [],
    reminders: {
      useDefault: event.reminders?.useDefault ?? true,
      overrides: event.reminders?.overrides ?? []
    },
    eventType,
    color: fallbackColor,
    colorId: event.colorId ?? EVENT_TYPE_BY_ID[eventType].googleColorId,
    etag: typeof event.etag === "string" ? event.etag : undefined
  };
}

export function mapClientEventToGoogle(payload: GoogleEventPayload) {
  return {
    summary: payload.title,
    description: payload.description,
    location: payload.location,
    start: payload.allDay
      ? { date: payload.start.split("T")[0] }
      : { dateTime: payload.start, timeZone: payload.timeZone },
    end: payload.allDay
      ? { date: payload.end.split("T")[0] }
      : { dateTime: payload.end, timeZone: payload.timeZone },
    attendees: payload.attendees.map((email) => ({ email })),
    recurrence: payload.recurrence,
    reminders: payload.reminders,
    colorId: payload.colorId,
    extendedProperties: {
      private: {
        eventType: payload.eventType
      }
    }
  };
}

/**
 * Map a PATCH: forward only the fields the caller actually sent.
 *
 * `events.patch` treats every key in the body as an instruction, so
 * `attendees: []` does not mean "no change to the guests" — it means "remove
 * them all". The full mapper above is right for creating an event and for the
 * editor, which sends every field on purpose. It was wrong for everything
 * else: three callers that only meant to update a title, a description or a
 * time sent `attendees: []`, `recurrence: []` and `colorId: "9"` alongside, so
 * typing into a doc linked to a meeting emptied that meeting's guest list, and
 * dragging an adopted event recoloured it.
 *
 * Here an omitted key is a preserved field. A caller that sends every key gets
 * byte-for-byte the same body as `mapClientEventToGoogle`.
 */
export function mapClientEventPatchToGoogle(payload: Partial<GoogleEventPayload>) {
  const out: Record<string, unknown> = {};
  if (payload.title !== undefined) out.summary = payload.title;
  if (payload.description !== undefined) out.description = payload.description;
  if (payload.location !== undefined) out.location = payload.location;
  if (payload.start !== undefined) {
    out.start = payload.allDay
      ? { date: payload.start.split("T")[0] }
      : { dateTime: payload.start, timeZone: payload.timeZone };
  }
  if (payload.end !== undefined) {
    out.end = payload.allDay
      ? { date: payload.end.split("T")[0] }
      : { dateTime: payload.end, timeZone: payload.timeZone };
  }
  if (payload.attendees !== undefined) out.attendees = payload.attendees.map((email) => ({ email }));
  if (payload.recurrence !== undefined) out.recurrence = payload.recurrence;
  if (payload.reminders !== undefined) out.reminders = payload.reminders;
  if (payload.colorId !== undefined) out.colorId = payload.colorId;
  if (payload.eventType !== undefined) {
    out.extendedProperties = { private: { eventType: payload.eventType } };
  }
  return out;
}

function getHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, key: string) {
  if (!headers) return "";
  const found = headers.find((header) => header.name?.toLowerCase() === key.toLowerCase());
  return found?.value?.trim() ?? "";
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  "#39": "'"
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    const normalized = entity.toLowerCase();

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return HTML_ENTITY_MAP[normalized] ?? match;
  });
}

function decodeBase64Url(value: string | undefined) {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractBodyParts(payload: any): { text: string; html: string } {
  if (!payload) {
    return { text: "", html: "" };
  }

  const mimeType = payload.mimeType ?? "";
  const ownBody = decodeBase64Url(payload.body?.data);
  let text = mimeType === "text/plain" ? ownBody : "";
  let html = mimeType === "text/html" ? ownBody : "";

  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const extracted = extractBodyParts(part);
    if (!text && extracted.text) {
      text = extracted.text;
    }
    if (!html && extracted.html) {
      html = extracted.html;
    }
    if (text && html) {
      break;
    }
  }

  return { text, html };
}

export function mapGoogleMessageToClient(message: any): GmailMessageSummary {
  const headers = (message.payload?.headers ?? []) as Array<{ name?: string | null; value?: string | null }>;
  const internalDate = Number(message.internalDate);
  const dateHeader = getHeaderValue(headers, "Date");
  const parsedDateCandidate = Number.isFinite(internalDate)
    ? new Date(internalDate)
    : dateHeader
      ? new Date(dateHeader)
      : new Date();
  const parsedDate = Number.isNaN(parsedDateCandidate.getTime()) ? new Date() : parsedDateCandidate;

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: decodeHtmlEntities(getHeaderValue(headers, "Subject")) || "(No subject)",
    from: decodeHtmlEntities(getHeaderValue(headers, "From")) || "Unknown sender",
    snippet: decodeHtmlEntities(message.snippet ?? ""),
    date: parsedDate.toISOString(),
    isUnread: Array.isArray(message.labelIds) && message.labelIds.includes("UNREAD")
  };
}

function htmlToCleanText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section|article|header|footer|blockquote|pre)>/gi, "\n")
    .replace(/<(?:p|div|tr|li|h[1-6]|section|article|header|footer|blockquote|pre)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\t/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mapGoogleMessageToDetail(message: any): GmailMessageDetail {
  const summary = mapGoogleMessageToClient(message);
  const headers = (message.payload?.headers ?? []) as Array<{ name?: string | null; value?: string | null }>;
  const to = getHeaderValue(headers, "To") || "Unknown recipient";
  const ccRaw = getHeaderValue(headers, "Cc") || getHeaderValue(headers, "CC");
  const extractedBody = extractBodyParts(message.payload);

  const rawHtml = extractedBody.html.trim();
  const body =
    extractedBody.text.trim() ||
    (rawHtml ? htmlToCleanText(rawHtml) : "") ||
    summary.snippet;

  return {
    ...summary,
    to,
    cc: ccRaw || undefined,
    body: decodeHtmlEntities(body),
    htmlBody: rawHtml ? decodeHtmlEntities(rawHtml) : undefined
  };
}
