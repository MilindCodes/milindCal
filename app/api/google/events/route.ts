import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient, mapClientEventToGoogle, mapGoogleEventToClient } from "@/lib/google";
import type { CalendarEvent, CalendarSummary, GoogleEventPayload } from "@/lib/models";
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

  const calendarList = await calendar.calendarList.list({ minAccessRole: "reader" });
  const calendarsById = new Map<string, CalendarSummary>();

  for (const calendarItem of calendarList.data.items ?? []) {
    if (!calendarItem.id) continue;
    calendarsById.set(calendarItem.id, {
      id: calendarItem.id,
      summary: calendarItem.summary ?? "Untitled",
      backgroundColor: calendarItem.backgroundColor ?? "#4f8cff"
    });
  }

  const settled = await Promise.allSettled(
    calendarIds.map(async (calendarId) => {
      const response = await calendar.events.list({
        calendarId,
        singleEvents: true,
        showDeleted: false,
        orderBy: "startTime",
        maxResults: 2500,
        timeMin: timeMin ?? undefined,
        timeMax: timeMax ?? undefined
      });

      return {
        calendarId,
        events: (response.data.items ?? []).map((item) =>
          mapGoogleEventToClient(item, calendarId, calendarsById.get(calendarId)?.backgroundColor)
        )
      };
    })
  );

  const events: CalendarEvent[] = [];
  const failedCalendarIds: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      events.push(...result.value.events);
    } else {
      failedCalendarIds.push(calendarIds[index]);
    }
  });

  return NextResponse.json({ events, failedCalendarIds });
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

  if (session.user?.email) {
    await touchUserSync(session.user.email);
  }

  return NextResponse.json({
    event: mapGoogleEventToClient(created.data, calendarId)
  });
}
