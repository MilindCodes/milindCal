import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { calendar_v3 } from "@googleapis/calendar";
import { authOptions } from "@/lib/auth";
import { getCalendarClient, getCalendarColors, mapClientEventToGoogle, mapGoogleEventToClient } from "@/lib/google";
import type { CalendarEvent, GoogleEventPayload } from "@/lib/models";
import { touchUserSync } from "@/lib/watch-store";

export const runtime = "nodejs";

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

  const body = await req.json().catch(() => null);
  const calendarId = body?.calendarId;
  const event = body?.event as GoogleEventPayload | undefined;

  if (!calendarId || !event?.title || !event?.start || !event?.end) {
    return NextResponse.json({ error: "Missing required event fields" }, { status: 400 });
  }
  event.attendees = Array.isArray(event.attendees) ? event.attendees : [];
  event.recurrence = Array.isArray(event.recurrence) ? event.recurrence : [];

  const calendar = getCalendarClient(session.accessToken);
  let created: { data: calendar_v3.Schema$Event };
  let colors: Map<string, string>;
  try {
    // The colour lookup is usually a cache hit; on a miss it runs alongside
    // the insert rather than after it.
    [created, colors] = await Promise.all([
      calendar.events.insert({
        calendarId,
        sendUpdates: event.attendees.length ? "all" : "none",
        requestBody: mapClientEventToGoogle(event)
      }),
      getCalendarColors(calendar, session.accessToken)
    ]);
  } catch (err) {
    console.error("[events] create failed:", err);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }

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
    event: mapGoogleEventToClient(created.data, calendarId, colors.get(calendarId))
  });
}
