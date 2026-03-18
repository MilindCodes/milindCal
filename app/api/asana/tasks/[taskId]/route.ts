import { type NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { asanaFetch } from "@/lib/asana";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  try {
    const body = await req.json() as {
      name?: string;
      notes?: string;
      due_on?: string | null;
      completed?: boolean;
    };

    const response = await asanaFetch(`/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ data: body }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Asana API error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json() as { data: { gid: string; name: string } };
    return NextResponse.json({ task: data.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update task";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  try {
    const response = await asanaFetch(`/tasks/${taskId}`, { method: "DELETE" });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Asana API error: ${errText}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete task";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
