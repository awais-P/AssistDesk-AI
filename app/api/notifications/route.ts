import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { listNotifications, markNotificationsRead } from "@/src/lib/notifications";

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json(await listNotifications(session.user.workspaceId, session.user.id));
}

/** Mark notifications as read: body `{ ids: string[] }` or `{ all: true }`. */
export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
  const ids =
    body.all === true
      ? "all"
      : Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100)
        : [];

  if (ids !== "all" && ids.length === 0) {
    return NextResponse.json({ error: "Pass ids or all: true." }, { status: 400 });
  }

  const marked = await markNotificationsRead(session.user.workspaceId, session.user.id, ids);

  return NextResponse.json({ success: true, marked });
}
