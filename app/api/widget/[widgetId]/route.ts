import { NextResponse } from "next/server";
import { authorizeWidgetRequest } from "@/src/lib/chatbot-widget";
import { isWorkspaceOnline } from "@/src/lib/presence";

type WidgetRouteContext = {
  params: Promise<{
    widgetId: string;
  }>;
};

export async function GET(request: Request, context: WidgetRouteContext) {
  const { widgetId } = await context.params;
  const access = await authorizeWidgetRequest(request, widgetId);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { chatbot } = access;
  const operatorsOnline = await isWorkspaceOnline(chatbot.workspaceId);
  const aiAvailable =
    chatbot.isActive && chatbot.aiRepliesEnabled && chatbot.agent.status === "ACTIVE";

  // Public, unauthenticated config: internal prompts and settings are not exposed.
  return NextResponse.json({
    chatbot: {
      id: chatbot.id,
      name: chatbot.name,
      widgetId: chatbot.widgetId,
      welcomeMessage: chatbot.welcomeMessage,
      primaryColor: chatbot.primaryColor,
      avatarUrl: chatbot.avatarUrl,
      conversationStarters: chatbot.conversationStarters,
      isActive: chatbot.isActive,
      widgetPosition: chatbot.widgetPosition,
      requireName: chatbot.requireName,
      requireEmail: chatbot.requireEmail,
      requirePhone: chatbot.requirePhone,
      emailNotifications: chatbot.emailNotifications,
      agentName: chatbot.agent.name,
      online: chatbot.isActive && (operatorsOnline || aiAvailable),
      operatorsOnline,
      isPreview: access.isPreview,
    },
  });
}
