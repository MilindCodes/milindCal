import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGmailClient, mapGoogleMessageToDetail } from "@/lib/google";

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

function getHeaderValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, key: string) {
  if (!headers) return "";
  const found = headers.find((header) => header.name?.toLowerCase() === key.toLowerCase());
  return found?.value?.trim() ?? "";
}

function extractEmailAddress(rawFromHeader: string) {
  const bracketMatch = rawFromHeader.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }
  const directMatch = rawFromHeader.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return directMatch?.[0]?.trim() ?? rawFromHeader.trim();
}

function toReplySubject(subject: string) {
  if (!subject) {
    return "Re: (No subject)";
  }
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function toBase64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(_req: Request, { params }: { params: { emailId: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!params.emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  try {
    const gmail = getGmailClient(session.accessToken);
    const message = await gmail.users.messages.get({
      userId: "me",
      id: params.emailId,
      format: "full",
      metadataHeaders: ["Subject", "From", "To", "Date"]
    });

    return NextResponse.json({ email: mapGoogleMessageToDetail(message.data) });
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

export async function POST(req: Request, { params }: { params: { emailId: string } }) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!params.emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;

  try {
    const gmail = getGmailClient(session.accessToken);

    if (action === "archive") {
      await gmail.users.messages.modify({
        userId: "me",
        id: params.emailId,
        requestBody: {
          removeLabelIds: ["INBOX"]
        }
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "reply") {
      const replyText = String(body?.replyText ?? "").trim();
      if (!replyText) {
        return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
      }

      const sourceMessage = await gmail.users.messages.get({
        userId: "me",
        id: params.emailId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Message-ID", "References"]
      });

      const headers = (sourceMessage.data.payload?.headers ?? []) as Array<{
        name?: string | null;
        value?: string | null;
      }>;

      const fromHeader = getHeaderValue(headers, "From");
      const subject = toReplySubject(getHeaderValue(headers, "Subject"));
      const messageId = getHeaderValue(headers, "Message-ID");
      const references = getHeaderValue(headers, "References");
      const to = extractEmailAddress(fromHeader);

      if (!to) {
        return NextResponse.json({ error: "Unable to determine recipient for reply" }, { status: 400 });
      }

      const referencesValue = [references, messageId].filter(Boolean).join(" ").trim();
      const rawMessage = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        messageId ? `In-Reply-To: ${messageId}` : "",
        referencesValue ? `References: ${referencesValue}` : "",
        "",
        replyText
      ]
        .filter(Boolean)
        .join("\r\n");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          threadId: sourceMessage.data.threadId ?? undefined,
          raw: toBase64Url(rawMessage)
        }
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    if (isMissingGmailScope(error)) {
      return NextResponse.json(
        {
          error:
            "Gmail modify/send permission is missing for this session. Sign out of milindCal and sign in again to grant full Gmail access."
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
