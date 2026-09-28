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
      select: {
        id: true,
        name: true,
        widgetId: true,
        agentId: true,
        allowedDomains: true,
        primaryColor: true,
        welcomeMessage: true,
        isActive: true,
        maxAiMessages: true,
        aiRepliesEnabled: true,
        replyMode: true,
        fallbackDelaySeconds: true,
        additionalPrompt: true,
        avatarUrl: true,
        conversationStarters: true,
        widgetPosition: true,
        requireName: true,
        requireEmail: true,
        requirePhone: true,
        emailNotifications: true,
        agent: {
          select: {
            name: true,
            status: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 100,
    }),
    prisma.aIAgent.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        name: true,
        status: true,
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
        agentStatus: chatbot.agent.status,
        allowedDomains: chatbot.allowedDomains,
        primaryColor: chatbot.primaryColor,
        welcomeMessage: chatbot.welcomeMessage,
        isActive: chatbot.isActive,
        maxAiMessages: chatbot.maxAiMessages,
        aiRepliesEnabled: chatbot.aiRepliesEnabled,
        replyMode: chatbot.replyMode,
        fallbackDelaySeconds: chatbot.fallbackDelaySeconds,
        additionalPrompt: chatbot.additionalPrompt,
        avatarUrl: chatbot.avatarUrl,
        conversationStarters: chatbot.conversationStarters,
        widgetPosition: chatbot.widgetPosition,
        requireName: chatbot.requireName,
        requireEmail: chatbot.requireEmail,
        requirePhone: chatbot.requirePhone,
        emailNotifications: chatbot.emailNotifications,
      }))}
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
      }))}
    />
  );
}
