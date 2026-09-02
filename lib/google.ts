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
