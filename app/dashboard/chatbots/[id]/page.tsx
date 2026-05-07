import { notFound, redirect } from "next/navigation";
import { ChatbotConfigurationWorkspace } from "@/src/components/dashboard/chatbot-configuration-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type ChatbotDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ChatbotDetailPage({
  params,
}: ChatbotDetailPageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { id } = await params;

  const [chatbot, agents] = await Promise.all([
    prisma.chatbot.findFirst({
      where: {
        id,
        workspaceId: session.user.workspaceId,
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

  if (!chatbot) {
    notFound();
  }

  return (
    <ChatbotConfigurationWorkspace
      chatbot={{
        id: chatbot.id,
        name: chatbot.name,
        widgetId: chatbot.widgetId,
        agentId: chatbot.agentId,
        allowedDomains: chatbot.allowedDomains,
        primaryColor: chatbot.primaryColor,
        welcomeMessage: chatbot.welcomeMessage,
        isActive: chatbot.isActive,
        maxAiMessages: chatbot.maxAiMessages,
      }}
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
      }))}
    />
  );
}
