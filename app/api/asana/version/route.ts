import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAsanaSyncVersion } from "@/lib/asana";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const version = await getAsanaSyncVersion();
  return NextResponse.json(
    { version, serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
