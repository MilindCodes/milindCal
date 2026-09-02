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

/** Split a header containing multiple addresses (comma-separated) into individual email strings */
function splitAddresses(header: string): string[] {
  if (!header.trim()) return [];
  // Split on commas not inside angle brackets
  return header
    .split(/,(?![^<]*>)/)
    .map((s) => s.trim())
    .filter(Boolean);
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

export async function GET(_req: Request, context: { params: Promise<{ emailId: string }> }) {
  const { emailId } = await context.params;
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  try {
    const gmail = getGmailClient(session.accessToken);
    const message = await gmail.users.messages.get({
      userId: "me",
      id: emailId,
      format: "full",
      metadataHeaders: ["Subject", "From", "To", "Cc", "Date", "Reply-To"]
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

export async function POST(req: Request, context: { params: Promise<{ emailId: string }> }) {
  const { emailId } = await context.params;
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!emailId) {
    return NextResponse.json({ error: "Missing email id" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;

  try {
    const gmail = getGmailClient(session.accessToken);

    if (action === "archive") {
      await gmail.users.messages.modify({
        userId: "me",
        id: emailId,
        requestBody: {
          removeLabelIds: ["INBOX"]
        }
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "reply" || action === "reply-all") {
      const replyText = String(body?.replyText ?? "").trim();
      if (!replyText) {
        return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
      }

      const extraCc = String(body?.cc ?? "").trim();
      const extraBcc = String(body?.bcc ?? "").trim();

      const sourceMessage = await gmail.users.messages.get({
        userId: "me",
        id: emailId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Cc", "Reply-To", "Message-ID", "References"]
      });

      const headers = (sourceMessage.data.payload?.headers ?? []) as Array<{
        name?: string | null;
        value?: string | null;
      }>;

      const fromHeader = getHeaderValue(headers, "From");
      const replyToHeader = getHeaderValue(headers, "Reply-To");
      const originalTo = getHeaderValue(headers, "To");
      const originalCc = getHeaderValue(headers, "Cc");
      const subject = toReplySubject(getHeaderValue(headers, "Subject"));
      const messageId = getHeaderValue(headers, "Message-ID");
      const references = getHeaderValue(headers, "References");

      // Primary "To" recipient — prefer Reply-To over From
      const primaryRecipient = extractEmailAddress(replyToHeader || fromHeader);
      if (!primaryRecipient) {
        return NextResponse.json({ error: "Unable to determine recipient for reply" }, { status: 400 });
      }

      let ccValue = extraCc;

      if (action === "reply-all") {
        // Fetch the user's own email to exclude from CC
        const profileRes = await gmail.users.getProfile({ userId: "me" });
        const myEmail = (profileRes.data.emailAddress ?? "").toLowerCase();

        // Collect all original To + Cc addresses minus self and the primary To
        const allOriginal = [
          ...splitAddresses(originalTo),
          ...splitAddresses(originalCc),
        ];
        const ccAddresses = allOriginal
          .map((addr) => extractEmailAddress(addr))
          .filter((addr) => addr && addr.toLowerCase() !== myEmail && addr.toLowerCase() !== primaryRecipient.toLowerCase());

        // Merge with any manually provided CC
        const mergedCc = [...new Set([...ccAddresses, ...splitAddresses(extraCc).map((a) => extractEmailAddress(a)).filter(Boolean)])];
        ccValue = mergedCc.join(", ");
      }

      const referencesValue = [references, messageId].filter(Boolean).join(" ").trim();
      const rawMessage = [
        `To: ${primaryRecipient}`,
        ccValue ? `Cc: ${ccValue}` : "",
        extraBcc ? `Bcc: ${extraBcc}` : "",
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
