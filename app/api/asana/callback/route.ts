import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exchangeCodeForToken, saveToken } from "@/lib/asana";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/?asana_error=unauthorized", req.url));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      new URL(`/?asana_error=${encodeURIComponent(oauthError)}`, req.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?asana_error=missing_params", req.url));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("asana_oauth_state")?.value;

  if (!storedState || storedState !== state) {
    return NextResponse.redirect(new URL("/?asana_error=invalid_state", req.url));
  }

  cookieStore.delete("asana_oauth_state");

  try {
    const token = await exchangeCodeForToken(code);
    await saveToken(token);
    return NextResponse.redirect(new URL("/?asana_connected=1", req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token_exchange_failed";
    return NextResponse.redirect(
      new URL(`/?asana_error=${encodeURIComponent(msg)}`, req.url)
    );
  }
}
