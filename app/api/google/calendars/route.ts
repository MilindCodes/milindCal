import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCalendarClient } from "@/lib/google";

function toErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const anyError = error as {
      message?: string;
      response?: { data?: { error?: { message?: string } } };
      errors?: Array<{ message?: string }>;
    };

    return (
      anyError.response?.data?.error?.message ||
      anyError.errors?.[0]?.message ||
      anyError.message ||
      "Google Calendar request failed"
    );
  }

  return "Google Calendar request failed";
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const calendar = getCalendarClient(session.accessToken);
    const response = await calendar.calendarList.list({
      minAccessRole: "reader",
      showHidden: false
    });

    const calendars = (response.data.items ?? []).map((item) => ({
      id: item.id ?? "",
      summary: item.summary ?? "Untitled",
      description: item.description ?? "",
      backgroundColor: item.backgroundColor ?? "#4f8cff",
      foregroundColor: item.foregroundColor ?? "#ffffff",
      primary: item.primary ?? false,
      accessRole: item.accessRole ?? "reader"
    }));

    return NextResponse.json({ calendars });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const summary = body.summary?.trim();

  if (!summary) {
    return NextResponse.json({ error: "Calendar name is required" }, { status: 400 });
  }

  try {
    const calendar = getCalendarClient(session.accessToken);

    const created = await calendar.calendars.insert({
      requestBody: {
        summary,
        description: body.description ?? "",
        timeZone: body.timeZone ?? "UTC"
      }
    });

    if (!created.data.id) {
      return NextResponse.json({ error: "Failed to create calendar" }, { status: 500 });
    }

    if (body.backgroundColor) {
      await calendar.calendarList.patch({
        calendarId: created.data.id,
        requestBody: {
          backgroundColor: body.backgroundColor
        }
      });
    }

    const calendarListEntry = await calendar.calendarList.get({ calendarId: created.data.id });

    return NextResponse.json({
      calendar: {
        id: calendarListEntry.data.id ?? created.data.id,
        summary: calendarListEntry.data.summary ?? summary,
        description: calendarListEntry.data.description ?? body.description,
        backgroundColor: calendarListEntry.data.backgroundColor,
        foregroundColor: calendarListEntry.data.foregroundColor,
        primary: calendarListEntry.data.primary,
        accessRole: calendarListEntry.data.accessRole
      }
    });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
