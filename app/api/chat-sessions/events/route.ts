import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { createEventStream, subscribeToWorkspace } from "@/src/lib/realtime";
import { expireIdleSessions } from "@/src/lib/session-lifecycle";

export const dynamic = "force-dynamic";

/**
 * Live updates for the Chats page (Server-Sent Events, SRS CI-1). Emits `changed`
 * with the ids of sessions that got a message or a status change, so the page
 * re-fetches just in time instead of polling every few seconds. Each connection
 * also closes expired sessions once, so the dashboard shows timeouts promptly.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { workspaceId } = session.user;
  let cursor = new Date();

  await expireIdleSessions({ workspaceId, limit: 25 });

  return createEventStream({
    request,
    subscribe: (wake) => subscribeToWorkspace(workspaceId, wake),
    poll: async () => {
      const changed = await prisma.chatSession.findMany({
        where: { workspaceId, updatedAt: { gt: cursor } },
        orderBy: { updatedAt: "asc" },
        take: 50,
        select: { id: true, status: true, updatedAt: true },
      });

      if (changed.length === 0) {
        return [];
      }

      cursor = changed[changed.length - 1].updatedAt;

      return [
        {
          event: "changed",
          data: {
            sessions: changed.map((item) => ({ id: item.id, status: item.status })),
            at: cursor.toISOString(),
          },
        },
      ];
    },
  });
}
