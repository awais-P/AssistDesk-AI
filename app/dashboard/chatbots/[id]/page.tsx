import { notFound, redirect } from "next/navigation";
import { ChatbotConfigurationWorkspace } from "@/src/components/dashboard/chatbot-configuration-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { parseLeadForm } from "@/src/lib/lead-form";
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
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
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
        sessionTimeoutMinutes: chatbot.sessionTimeoutMinutes,
        rateLimitPerMinute: chatbot.rateLimitPerMinute,
        additionalPrompt: chatbot.additionalPrompt,
        avatarUrl: chatbot.avatarUrl,
        conversationStarters: chatbot.conversationStarters,
        widgetPosition: chatbot.widgetPosition,
        requireName: chatbot.requireName,
        requireEmail: chatbot.requireEmail,
        requirePhone: chatbot.requirePhone,
        emailNotifications: chatbot.emailNotifications,
        leadForm: parseLeadForm(chatbot.leadForm),
      }}
      agentOptions={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
      }))}
    />
  );
}
