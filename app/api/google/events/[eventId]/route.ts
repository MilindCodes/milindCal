import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient, mapClientEventToGoogle, mapGoogleEventToClient } from "@/lib/google";
import type { GoogleEventPayload } from "@/lib/models";
import { touchUserSync } from "@/lib/watch-store";

export const runtime = "nodejs";

/** GET /api/google/events/[eventId]?calendarId=… — fetch a single event fresh from Google */
export async function GET(req: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const calendarId = searchParams.get("calendarId") ?? "primary";

  const calendar = getCalendarClient(session.accessToken);

  try {
    const [eventRes, calRes] = await Promise.all([
      calendar.events.get({ calendarId, eventId }),
      calendar.calendarList.get({ calendarId }).catch(() => null),
    ]);
    const calendarColor = calRes?.data?.backgroundColor ?? undefined;
    return NextResponse.json({
      event: mapGoogleEventToClient(eventRes.data, calendarId, calendarColor),
    }, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" }
    });
  } catch {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const calendarId = body.calendarId;
  const event = body.event as GoogleEventPayload;

  if (!calendarId || !event || !eventId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const calendar = getCalendarClient(session.accessToken);
  try {
    const updated = await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: event.attendees.length ? "all" : "none",
      requestBody: mapClientEventToGoogle(event)
    });

    // The event is already updated on Google's side at this point — don't let a
    // sync-signal hiccup (e.g. a transient KV blip) fall into the catch below and
    // report an already-successful update as a failure.
    if (session.user?.email) {
      await touchUserSync(session.user.email).catch((err) => {
        console.error("[events] touchUserSync failed after successful update:", err);
      });
    }

    return NextResponse.json({
      event: mapGoogleEventToClient(updated.data, calendarId)
    });
  } catch {
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await context.params;
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const calendarId = searchParams.get("calendarId");

  if (!calendarId || !eventId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const calendar = getCalendarClient(session.accessToken);
  await calendar.events.delete({
    calendarId,
    eventId,
    sendUpdates: "all"
  });

  // The event is already deleted on Google's side at this point — a sync-signal
  // hiccup must not report an already-successful delete as a failure.
  if (session.user?.email) {
    await touchUserSync(session.user.email).catch((err) => {
      console.error("[events] touchUserSync failed after successful delete:", err);
    });
  }

  return NextResponse.json({ ok: true });
}
