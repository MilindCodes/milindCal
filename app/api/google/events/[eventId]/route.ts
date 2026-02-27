import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient, mapClientEventToGoogle, mapGoogleEventToClient } from "@/lib/google";
import type { GoogleEventPayload } from "@/lib/models";
import { touchUserSync } from "@/lib/watch-store";

export const runtime = "nodejs";

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
  const updated = await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: event.attendees.length ? "all" : "none",
    requestBody: mapClientEventToGoogle(event)
  });

  if (session.user?.email) {
    await touchUserSync(session.user.email);
  }

  return NextResponse.json({
    event: mapGoogleEventToClient(updated.data, calendarId)
  });
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

  if (session.user?.email) {
    await touchUserSync(session.user.email);
  }

  return NextResponse.json({ ok: true });
}
