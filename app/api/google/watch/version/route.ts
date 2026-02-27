import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readUserSyncVersion } from "@/lib/watch-store";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  if (!userEmail) {
    return NextResponse.json({ error: "Session is missing user email" }, { status: 400 });
  }

  const version = await readUserSyncVersion(userEmail);

  return NextResponse.json(
    {
      version,
      serverTime: Date.now()
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
