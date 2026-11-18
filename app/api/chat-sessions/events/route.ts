import { NextResponse } from "next/server";
import { onlineVisitorSessions } from "@/src/lib/visitor-presence";
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

  let lastOnline: string | null = null;

  return createEventStream({
    request,
    subscribe: (wake) => subscribeToWorkspace(workspaceId, wake),
    poll: async () => {
      const payloads: Array<{ event: string; data: unknown }> = [];
      // FR-6.2: which visitors have the chat open; sent when it changes (and on connect).
      const online = onlineVisitorSessions(workspaceId);
      const onlineKey = online.join(",");

      if (onlineKey !== lastOnline) {
        lastOnline = onlineKey;
        payloads.push({ event: "presence", data: { online } });
      }

      const changed = await prisma.chatSession.findMany({
        where: { workspaceId, updatedAt: { gt: cursor } },
        orderBy: { updatedAt: "asc" },
        take: 50,
        select: { id: true, status: true, updatedAt: true },
      });

      if (changed.length === 0) {
        return payloads;
      }

      cursor = changed[changed.length - 1].updatedAt;

      return [
        ...payloads,
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
