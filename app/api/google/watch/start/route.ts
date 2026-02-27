import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient } from "@/lib/google";
import { createWatchToken } from "@/lib/watch-token";
import { listUserChannels, putChannels, removeChannels, touchUserSync, type WatchChannel } from "@/lib/watch-store";

export const runtime = "nodejs";

function resolveWebhookUrl() {
  return process.env.GOOGLE_WEBHOOK_URL || `${process.env.NEXTAUTH_URL}/api/google/watch/webhook`;
}

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
  const calendarIds = Array.from(
    new Set(
      (body.calendarIds ?? [])
        .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    )
  );

  if (!calendarIds.length) {
    return NextResponse.json({ error: "calendarIds is required" }, { status: 400 });
  }

  const webhookUrl = resolveWebhookUrl();
  if (!webhookUrl?.startsWith("https://")) {
    return NextResponse.json(
      {
        error:
          "Google push webhooks require HTTPS. Set GOOGLE_WEBHOOK_URL to your deployed HTTPS URL (or tunnel URL)."
      },
      { status: 400 }
    );
  }

  const calendar = getCalendarClient(session.accessToken);
  const now = Date.now();
  const renewThreshold = now + 10 * 60 * 1000;

  const existing = await listUserChannels(userEmail);

  const stopCandidates = existing.filter(
    (item) => !calendarIds.includes(item.calendarId) || item.expiration <= renewThreshold
  );

  if (stopCandidates.length) {
    await Promise.all(
      stopCandidates.map(async (item) => {
        try {
          await calendar.channels.stop({
            requestBody: {
              id: item.channelId,
              resourceId: item.resourceId
            }
          });
        } catch {
          // Ignore remote stop failures and clear local state anyway.
        }
      })
    );

    await removeChannels(stopCandidates.map((item) => item.channelId));
  }

  const activeByCalendar = new Map(
    existing
      .filter((item) => !stopCandidates.some((candidate) => candidate.channelId === item.channelId))
      .map((item) => [item.calendarId, item])
  );

  const createdChannels: WatchChannel[] = [];
  const failedCalendarIds: string[] = [];

  for (const calendarId of calendarIds) {
    if (activeByCalendar.has(calendarId)) {
      continue;
    }

    const channelId = randomUUID();
    const expiration = now + 7 * 24 * 60 * 60 * 1000;

    try {
      const token = createWatchToken({
        channelId,
        calendarId,
        userEmail,
        exp: expiration
      });

      const watched = await calendar.events.watch({
        calendarId,
        requestBody: {
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          token,
          params: {
            ttl: "604800"
          }
        }
      });

      if (!watched.data.resourceId) {
        failedCalendarIds.push(calendarId);
        continue;
      }

      const expiresAt = watched.data.expiration ? Number(watched.data.expiration) : expiration;

      createdChannels.push({
        channelId,
        resourceId: watched.data.resourceId,
        userEmail,
        calendarId,
        expiration: Number.isFinite(expiresAt) ? expiresAt : expiration,
        token,
        createdAt: now
      });
    } catch {
      failedCalendarIds.push(calendarId);
    }
  }

  if (createdChannels.length) {
    await putChannels(createdChannels);
  }

  await touchUserSync(userEmail);

  const mergedChannels = [
    ...Array.from(activeByCalendar.values()).filter((item) => calendarIds.includes(item.calendarId)),
    ...createdChannels
  ];

  return NextResponse.json({
    channels: mergedChannels.map((item) => ({
      channelId: item.channelId,
      calendarId: item.calendarId,
      expiration: item.expiration
    })),
    webhookUrl,
    mode: "push",
    failedCalendarIds
  });
}
