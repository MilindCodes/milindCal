import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCalendarClient,
  getCalendarColors,
  googleErrorStatus,
  mapClientEventPatchToGoogle,
  mapGoogleEventToClient
} from "@/lib/google";
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
    // The colour comes from the shared cache — usually no request at all —
    // rather than a calendarList.get on every open.
    const [eventRes, colors] = await Promise.all([
      calendar.events.get({ calendarId, eventId }),
      getCalendarColors(calendar, session.accessToken),
    ]);
    return NextResponse.json({
      event: mapGoogleEventToClient(eventRes.data, calendarId, colors.get(calendarId)),
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

  const body = await req.json().catch(() => null);
  const calendarId = body?.calendarId;
  // Partial on purpose: a key the client leaves out is a field Google keeps.
  const event = body?.event as Partial<GoogleEventPayload> | undefined;

  if (!calendarId || !event || !eventId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Only email guests when the caller is managing the guest list. A time
  // or title change with no attendees key leaves them, and their inboxes,
  // alone — unless the caller says otherwise: a drag sends only the new time
  // and asks for guests to be told, as Google Calendar itself does.
  const sendUpdates: "all" | "none" =
    body.sendUpdates === "all" || body.sendUpdates === "none"
      ? body.sendUpdates
      : event.attendees?.length ? "all" : "none";

  const calendar = getCalendarClient(session.accessToken);
  try {
    const [updated, colors] = await Promise.all([
      calendar.events.patch({
        calendarId,
        eventId,
        sendUpdates,
        requestBody: mapClientEventPatchToGoogle(event)
      }),
      getCalendarColors(calendar, session.accessToken),
    ]);

    // The event is already updated on Google's side at this point — don't let a
    // sync-signal hiccup (e.g. a transient KV blip) fall into the catch below and
    // report an already-successful update as a failure.
    if (session.user?.email) {
      await touchUserSync(session.user.email).catch((err) => {
        console.error("[events] touchUserSync failed after successful update:", err);
      });
    }

    return NextResponse.json({
      event: mapGoogleEventToClient(updated.data, calendarId, colors.get(calendarId))
    });
  } catch (err) {
    console.error("[events] update failed:", err);
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
  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "all"
    });
  } catch (err) {
    // Already gone is the outcome the caller asked for. Deleting an event
    // that was removed on another device answered 410, which escaped as an
    // unhandled throw — an HTML 500 the client reported as a failed delete.
    const status = googleErrorStatus(err);
    if (status !== 404 && status !== 410) {
      console.error("[events] delete failed:", err);
      return NextResponse.json({ error: "Failed to delete event" }, { status: status === 403 ? 403 : 500 });
    }
  }

  // The event is already deleted on Google's side at this point — a sync-signal
  // hiccup must not report an already-successful delete as a failure.
  if (session.user?.email) {
    await touchUserSync(session.user.email).catch((err) => {
      console.error("[events] touchUserSync failed after successful delete:", err);
    });
  }

  return NextResponse.json({ ok: true });
}
