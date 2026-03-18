import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildOAuthURL } from "@/lib/asana";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If a Personal Access Token is already configured, no OAuth dance needed —
  // just bounce the user back to the app as connected.
  if (process.env.ASANA_ACCESS_TOKEN) {
    const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    return NextResponse.redirect(new URL("/?asana_connected=1", base));
  }

  if (!process.env.ASANA_CLIENT_ID || !process.env.ASANA_REDIRECT_URI) {
    const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    return NextResponse.redirect(
      new URL("/?asana_error=missing_env", base)
    );
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("asana_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return NextResponse.redirect(buildOAuthURL(state));
}
