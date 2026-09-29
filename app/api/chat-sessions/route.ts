import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { loadChatSessionList, parseChatListFilters } from "@/src/lib/chat-session-list";
import { expireIdleSessions } from "@/src/lib/session-lifecycle";

/**
 * Conversation list for the Chats page (Module 5 FE-4). Filters: `status`
 * (ACTIVE | ESCALATED | CLOSED | OPEN), `channel`, `contactId`, `q` (customer or
 * message text). `include=<id>` also returns that session (as `included`) when it is
 * outside the filter, so the conversation open on screen stays up to date. Sessions
 * whose idle/max-duration policy has passed are closed first.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await expireIdleSessions({ workspaceId: session.user.workspaceId, limit: 25 });

  const params = new URL(request.url).searchParams;
  const sessions = await loadChatSessionList(session.user.workspaceId, parseChatListFilters(params));
  const includeId = params.get("include")?.slice(0, 40);
  const included =
    includeId && !sessions.some((item) => item.id === includeId)
      ? ((await loadChatSessionList(session.user.workspaceId, { sessionIds: [includeId] }))[0] ?? null)
      : null;

  return NextResponse.json({ sessions, included });
}
