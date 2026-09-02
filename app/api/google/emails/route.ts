import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGmailClient, mapGoogleMessageToClient } from "@/lib/google";
import type { GmailMessageSummary } from "@/lib/models";

function toBase64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export const runtime = "nodejs";

function toErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const anyError = error as {
      code?: number;
      message?: string;
      response?: { status?: number; data?: { error?: { message?: string; status?: string } } };
      errors?: Array<{ message?: string; reason?: string }>;
    };

    return (
      anyError.response?.data?.error?.message ||
      anyError.errors?.[0]?.message ||
      anyError.message ||
      "Google Gmail request failed"
    );
  }

  return "Google Gmail request failed";
}

function isMissingGmailScope(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const anyError = error as {
    code?: number;
    message?: string;
    response?: { status?: number; data?: { error?: { message?: string } } };
    errors?: Array<{ reason?: string; message?: string }>;
  };

  const status = anyError.response?.status ?? anyError.code;
  const reason = anyError.errors?.[0]?.reason ?? "";
  const message =
    anyError.response?.data?.error?.message ||
    anyError.errors?.[0]?.message ||
    anyError.message ||
    "";

  return (
    status === 403 &&
    (reason === "insufficientPermissions" ||
      message.includes("insufficient authentication scopes") ||
      message.includes("insufficient permissions"))
  );
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawMax = Number(searchParams.get("max") ?? "20");
  const max = Number.isFinite(rawMax) ? Math.min(Math.max(Math.floor(rawMax), 1), 50) : 20;

  try {
    const gmail = getGmailClient(session.accessToken);
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: max
    });

    const messageIds = (listResponse.data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));

    if (!messageIds.length) {
      return NextResponse.json({ emails: [] });
    }

    const settled = await Promise.allSettled(
      messageIds.map(async (id) =>
        gmail.users.messages.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"]
        })
      )
    );

    const emails: GmailMessageSummary[] = [];
    let failedCount = 0;

    for (const result of settled) {
      if (result.status === "fulfilled") {
        emails.push(mapGoogleMessageToClient(result.value.data));
      } else {
        failedCount += 1;
      }
    }

    emails.sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime());

    return NextResponse.json({ emails, failedCount }, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" }
    });
  } catch (error) {
    if (isMissingGmailScope(error)) {
      return NextResponse.json(
        {
          error:
            "Gmail permission is missing for this session. Sign out of milindCal and sign in again to grant Gmail access."
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const to = String(body?.to ?? "").trim();
  const subject = String(body?.subject ?? "").trim();
  const emailBody = String(body?.body ?? "").trim();
  const cc = String(body?.cc ?? "").trim();
  const bcc = String(body?.bcc ?? "").trim();

  if (!to || !subject || !emailBody) {
    return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
  }

  try {
    const gmail = getGmailClient(session.accessToken);
    const rawMessage = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : "",
      bcc ? `Bcc: ${bcc}` : "",
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
      "",
      emailBody
    ]
      .filter(Boolean)
      .join("\r\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: toBase64Url(rawMessage) }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isMissingGmailScope(error)) {
      return NextResponse.json(
        {
          error:
            "Gmail send permission is missing for this session. Sign out of milindCal and sign in again to grant Gmail access."
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
