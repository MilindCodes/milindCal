import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { clearToken, getStoredToken } from "@/lib/asana";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // PAT takes priority over OAuth token
  if (process.env.ASANA_ACCESS_TOKEN) {
    return NextResponse.json({ connected: true, userName: "Asana (PAT)", mode: "pat" });
  }

  const token = await getStoredToken();
  if (!token) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    userName: token.userName,
    workspaceGid: token.workspaceGid,
    mode: "oauth",
  });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await clearToken();
  return NextResponse.json({ disconnected: true });
}
