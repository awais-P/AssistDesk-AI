import { redirect } from "next/navigation";
import { ChatsWorkspace } from "@/src/components/dashboard/chats-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { loadChatSessionList } from "@/src/lib/chat-session-list";
import { prisma } from "@/src/lib/prisma";
import { expireIdleSessions } from "@/src/lib/session-lifecycle";

type ChatsPageProps = {
  searchParams: Promise<{
    session?: string | string[];
  }>;
};

export default async function ChatsPage({ searchParams }: ChatsPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);

  if (!session) {
    redirect("/login");
  }

  // `?session=<id>` deep-links to one conversation (e.g. from a customer profile).
  // It opens the unfiltered list so the conversation is found whatever its status.
  const requestedSessionId =
    typeof resolvedSearchParams.session === "string"
      ? resolvedSearchParams.session.slice(0, 40) || null
      : null;
  const initialStatusFilter = requestedSessionId ? "ALL" : "OPEN";

  // Sessions past their idle / max-duration policy are closed before listing (FE-5).
  await expireIdleSessions({ workspaceId: session.user.workspaceId, limit: 25 });

  const [listed, requested, settings] = await Promise.all([
    loadChatSessionList(session.user.workspaceId, {
      status: initialStatusFilter === "OPEN" ? "OPEN" : null,
    }),
    // A deep-linked conversation older than the latest 50 is loaded on its own.
    requestedSessionId
      ? loadChatSessionList(session.user.workspaceId, { sessionIds: [requestedSessionId] })
      : Promise.resolve([]),
    prisma.workspaceSetting.findUnique({
      where: { workspaceId: session.user.workspaceId },
      select: { crossChannelMemory: true },
    }),
  ]);

  const chatSessions =
    requested[0] && !listed.some((item) => item.id === requested[0].id)
      ? [requested[0], ...listed]
      : listed;

  return (
    <ChatsWorkspace
      key={requestedSessionId ?? "inbox"}
      initialSessions={chatSessions}
      initialStatusFilter={initialStatusFilter}
      initialSelectedId={requestedSessionId}
      crossChannelMemory={settings?.crossChannelMemory !== false}
    />
  );
}
