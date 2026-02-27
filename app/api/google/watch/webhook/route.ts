import { NextResponse } from "next/server";
import { getChannel, putChannels, touchUserSync } from "@/lib/watch-store";
import { verifyWatchToken } from "@/lib/watch-token";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const channelId = req.headers.get("x-goog-channel-id");
  const resourceId = req.headers.get("x-goog-resource-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const channelExpiration = req.headers.get("x-goog-channel-expiration");

  if (!channelId || !resourceId) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  const channel = await getChannel(channelId);
  if (!channel) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  if (channel.resourceId !== resourceId) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  if (!channelToken) {
    return NextResponse.json({ error: "Missing channel token" }, { status: 401 });
  }

  const validToken = verifyWatchToken(channelToken, {
    channelId,
    calendarId: channel.calendarId,
    userEmail: channel.userEmail
  });

  if (!validToken) {
    return NextResponse.json({ error: "Invalid channel token" }, { status: 401 });
  }

  if (channelExpiration) {
    const parsedExpiry = Date.parse(channelExpiration);
    if (Number.isFinite(parsedExpiry) && parsedExpiry > channel.expiration) {
      await putChannels([
        {
          ...channel,
          expiration: parsedExpiry
        }
      ]);
    }
  }

  await touchUserSync(channel.userEmail);

  return NextResponse.json({ ok: true });
}
