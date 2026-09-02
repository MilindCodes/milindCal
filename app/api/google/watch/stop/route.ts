import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient } from "@/lib/google";
import { listUserChannels, removeChannels, touchUserSync } from "@/lib/watch-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  if (!userEmail) {
    return NextResponse.json({ error: "Session is missing user email" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const requestedIds = new Set(
    (body.calendarIds ?? [])
      .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  );

  const existing = await listUserChannels(userEmail);
  const toStop = requestedIds.size
    ? existing.filter((item) => requestedIds.has(item.calendarId))
    : existing;

  if (!toStop.length) {
    return NextResponse.json({ stopped: 0 });
  }

  const calendar = getCalendarClient(session.accessToken);

  await Promise.all(
    toStop.map(async (item) => {
      try {
        await calendar.channels.stop({
          requestBody: {
            id: item.channelId,
            resourceId: item.resourceId
          }
        });
      } catch {
        // Ignore remote stop failure and remove locally.
      }
    })
  );

  await removeChannels(toStop.map((item) => item.channelId));
  // Channels are already removed from the store at this point — a sync-signal
  // hiccup must not report an already-successful stop as a failure.
  await touchUserSync(userEmail).catch((err) => {
    console.error("[watch/stop] touchUserSync failed after successful stop:", err);
  });

  return NextResponse.json({ stopped: toStop.length });
}
