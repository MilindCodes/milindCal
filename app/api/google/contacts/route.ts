import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPeopleClient } from "@/lib/google";
import type { GmailContact } from "@/lib/models";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const people = getPeopleClient(session.accessToken);
    const res = await people.people.connections.list({
      resourceName: "people/me",
      personFields: "names,emailAddresses",
      pageSize: 500,
      sortOrder: "LAST_MODIFIED_DESCENDING",
    });

    const contacts: GmailContact[] = (res.data.connections ?? [])
      .flatMap((person) => {
        const emailEntry = person.emailAddresses?.[0];
        if (!emailEntry?.value) return [];
        const name =
          person.names?.[0]?.displayName ??
          emailEntry.value.split("@")[0];
        return [{ name, email: emailEntry.value }];
      });

    return NextResponse.json({ contacts });
  } catch {
    // Contacts scope may not be granted yet — return empty list gracefully
    return NextResponse.json({ contacts: [] });
  }
}
