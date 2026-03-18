import { type NextRequest, NextResponse } from "next/server";
import { getWebhookSecret, saveWebhookSecret, touchAsanaSync, verifyAsanaWebhookSignature } from "@/lib/asana";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Asana webhook handshake: first delivery contains X-Hook-Secret header.
  // We must echo it back to confirm ownership.
  const hookSecret = req.headers.get("x-hook-secret");
  if (hookSecret) {
    await saveWebhookSecret(hookSecret);
    return new NextResponse(null, {
      status: 200,
      headers: { "X-Hook-Secret": hookSecret },
    });
  }

  // Subsequent event deliveries: verify HMAC-SHA256 signature
  const signature = req.headers.get("x-hook-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const body = await req.text();
  const secret = await getWebhookSecret();

  if (!secret) {
    // Webhook not yet fully registered — accept silently
    return NextResponse.json({ ok: true });
  }

  const valid = verifyAsanaWebhookSignature(body, signature, secret);
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Touch sync version to trigger client polling refresh
  await touchAsanaSync();

  return NextResponse.json({ ok: true });
}
