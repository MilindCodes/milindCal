import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { calendar_v3 } from "@googleapis/calendar";
import { authOptions } from "@/lib/auth";
import { getCalendarClient, mapClientEventToGoogle, mapGoogleEventToClient } from "@/lib/google";
import type { CalendarEvent, GoogleEventPayload } from "@/lib/models";
import { touchUserSync } from "@/lib/watch-store";

export const runtime = "nodejs";

/* ── Calendar-colour cache ──────────────────────────────────────────────
 *
 * The only thing the calendarList fetch contributes to this route is a
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
 *  rather than failing the whole events request. */
async function getCalendarColors(
  calendar: ReturnType<typeof getCalendarClient>,
  accessToken: string
): Promise<ColorMap> {
  const key = cacheKeyFor(accessToken);
  const now = Date.now();

  const hit = colorCache.get(key);
  if (hit && now - hit.at < COLOR_CACHE_TTL_MS) return hit.colors;

  try {
    const response = await calendar.calendarList.list({ minAccessRole: "reader" });
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

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const idsFromQuery = searchParams.get("calendarIds") ?? "primary";
  const calendarIds = idsFromQuery
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");

  const calendar = getCalendarClient(session.accessToken);

  // Colours come from a cached calendarList; the fetch still runs in parallel
  // with the event pages on a cache miss, so it never delays them.
  const [colorsById, ...eventResults] = await Promise.all([
    getCalendarColors(calendar, session.accessToken),
    ...calendarIds.map(async (calendarId) => {
      // Paginate through all results — Google caps maxResults at 2500 per page.
      const allItems: unknown[] = [];
      let pageToken: string | undefined = undefined;

      while (true) {
        const page: { data: calendar_v3.Schema$Events } = await calendar.events.list({
          calendarId,
          singleEvents: true,
          showDeleted: false,
          orderBy: "startTime",
          maxResults: 2500,
          timeMin: timeMin ?? undefined,
          timeMax: timeMax ?? undefined,
          pageToken,
        });
        allItems.push(...(page.data.items ?? []));
        pageToken = page.data.nextPageToken ?? undefined;
        if (!pageToken) break;
      }

      return { calendarId, items: allItems };
    }).map((p) =>
      // Mirror the previous allSettled semantics: one failing calendar must not
      // fail the whole request, it just lands in failedCalendarIds.
      p.then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const, value: null })
      )
    )
  ]);

  const events: CalendarEvent[] = [];
  const failedCalendarIds: string[] = [];

  eventResults.forEach((result, index) => {
    if (result.ok) {
      const { calendarId, items } = result.value;
      const bgColor = colorsById.get(calendarId);
      events.push(
        ...(items as Array<{ status?: string }>)
          .filter((item) => item.status !== "cancelled")
          .map((item) => mapGoogleEventToClient(item, calendarId, bgColor))
      );
    } else {
      failedCalendarIds.push(calendarIds[index]);
    }
  });

  return NextResponse.json({ events, failedCalendarIds }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" }
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const calendarId = body.calendarId;
  const event = body.event as GoogleEventPayload;

  if (!calendarId || !event?.title || !event?.start || !event?.end) {
    return NextResponse.json({ error: "Missing required event fields" }, { status: 400 });
  }

  const calendar = getCalendarClient(session.accessToken);
  const created = await calendar.events.insert({
    calendarId,
    sendUpdates: event.attendees.length ? "all" : "none",
    requestBody: mapClientEventToGoogle(event)
  });

  if (!created.data.id) {
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }

  // The event is already created on Google's side at this point — a sync-signal
  // hiccup (e.g. a transient KV blip) must not turn an already-successful create
  // into a client-visible failure, which would invite a retry and a duplicate event.
  if (session.user?.email) {
    await touchUserSync(session.user.email).catch((err) => {
      console.error("[events] touchUserSync failed after successful create:", err);
    });
  }

  return NextResponse.json({
    event: mapGoogleEventToClient(created.data, calendarId)
  });
}
