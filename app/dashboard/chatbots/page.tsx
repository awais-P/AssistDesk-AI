import { redirect } from "next/navigation";
import { ChatbotsWorkspace } from "@/src/components/dashboard/chatbots-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function ChatbotsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [chatbots, agents] = await Promise.all([
    prisma.chatbot.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      include: {
        agent: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.aIAgent.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  return (
    <ChatbotsWorkspace
      initialChatbots={chatbots.map((chatbot) => ({
        id: chatbot.id,
        name: chatbot.name,
        widgetId: chatbot.widgetId,
        agentId: chatbot.agentId,
        agentName: chatbot.agent.name,
        allowedDomains: chatbot.allowedDomains,
        primaryColor: chatbot.primaryColor,
        welcomeMessage: chatbot.welcomeMessage,
        isActive: chatbot.isActive,
        maxAiMessages: chatbot.maxAiMessages,
      }))}
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
    />
  );
}
