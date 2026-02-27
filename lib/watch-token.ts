import { createHmac, timingSafeEqual } from "node:crypto";

interface WatchTokenPayload {
  channelId: string;
  calendarId: string;
  userEmail: string;
  exp: number;
}

function getSecret() {
  return process.env.WATCH_WEBHOOK_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(body: string) {
  const secret = getSecret();
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createWatchToken(payload: WatchTokenPayload) {
  const secret = getSecret();
  if (!secret) {
    throw new Error("WATCH_WEBHOOK_SECRET (or NEXTAUTH_SECRET) is required");
  }

  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = sign(body);
  return `${body}.${signature}`;
}

export function verifyWatchToken(token: string, input: Omit<WatchTokenPayload, "exp">) {
  const secret = getSecret();
  if (!secret) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [body, signature] = parts;
  const expected = sign(body);

  if (expected.length !== signature.length) {
    return false;
  }

  const validSig = timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!validSig) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as WatchTokenPayload;

    if (payload.exp < Date.now()) {
      return false;
    }

    return (
      payload.channelId === input.channelId &&
      payload.calendarId === input.calendarId &&
      payload.userEmail === input.userEmail
    );
  } catch {
    return false;
  }
}
