import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { asanaFetch, getValidToken } from "@/lib/asana";

export const runtime = "nodejs";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.ASANA_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "ASANA_WEBHOOK_URL is not set in environment variables" },
      { status: 400 }
    );
  }

  try {
    const token = await getValidToken();
    const response = await asanaFetch("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        data: {
          resource: token.workspaceGid,
          target: webhookUrl,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Webhook registration failed: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json() as { data: { gid: string } };
    return NextResponse.json({ webhook: data.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to register webhook";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
