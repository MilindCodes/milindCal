import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { asanaFetch, fetchAsanaTasks, getValidToken, mapAsanaTaskToLocal } from "@/lib/asana";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const asanaTasks = await fetchAsanaTasks();
    const tasks = asanaTasks.map(mapAsanaTaskToLocal);
    return NextResponse.json({ tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch tasks";
    if (msg === "ASANA_NOT_CONNECTED") {
      return NextResponse.json({ error: "Asana not connected", code: "NOT_CONNECTED" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      name: string;
      notes?: string;
      due_on?: string;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Task name is required" }, { status: 400 });
    }

    const token = await getValidToken();
    const payload = {
      data: {
        name: body.name.trim(),
        notes: body.notes ?? "",
        due_on: body.due_on ?? null,
        workspace: token.workspaceGid,
        assignee: "me",
      },
    };

    const response = await asanaFetch("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Asana API error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json() as { data: { gid: string; name: string } };
    return NextResponse.json({ task: data.data }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create task";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
