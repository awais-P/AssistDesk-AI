import { redirect } from "next/navigation";
import { ChatsWorkspace } from "@/src/components/dashboard/chats-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

export default async function ChatsPage() {
  const [, session] = await Promise.all([ensureDemoData(), getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const chatSessions = await prisma.chatSession.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      chatbot: true,
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });

  return (
    <ChatsWorkspace
      initialSessions={chatSessions.map((sessionItem) => ({
        id: sessionItem.id,
        customerName: sessionItem.customerName,
        customerEmail: sessionItem.customerEmail,
        status: sessionItem.status,
        channel: sessionItem.channel,
        startedAt: sessionItem.startedAt.toISOString(),
        chatbotName: sessionItem.chatbot?.name ?? null,
        messages: sessionItem.messages.map((message) => ({
          id: message.id,
          sender: message.sender,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
      }))}
    />
  );
}
