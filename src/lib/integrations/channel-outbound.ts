import { prisma } from "../prisma";
import { readIntegrationConfig } from "./config";
import { postSlackMessage } from "./slack";
import { sendWhatsAppText } from "./whatsapp";

export type ChannelDeliveryResult = {
  status: "SENT" | "FAILED" | "NOT_APPLICABLE";
  error: string | null;
};

/**
 * Sends a team member's chat reply to the customer's channel. Widget chats need no
 * delivery (the widget polls for new messages).
 */
export async function deliverAgentMessageToChannel(
  sessionId: string,
  content: string,
): Promise<ChannelDeliveryResult> {
  const chatSession = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: {
      channel: true,
      externalId: true,
      integration: { select: { type: true, config: true, isActive: true } },
    },
  });

  const integration = chatSession?.integration;

  if (!chatSession?.externalId || !integration) {
    return { status: "NOT_APPLICABLE", error: null };
  }

  try {
    if (integration.type === "SLACK") {
      const config = readIntegrationConfig("SLACK", integration.config);
      const [channel, threadTs] = chatSession.externalId.split(":");

      await postSlackMessage({
        botToken: config.botToken,
        channel,
        text: content,
        threadTs: threadTs || null,
      });
      return { status: "SENT", error: null };
    }

    if (integration.type === "WHATSAPP") {
      const config = readIntegrationConfig("WHATSAPP", integration.config);

      await sendWhatsAppText({
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
        to: chatSession.externalId,
        text: content,
      });
      return { status: "SENT", error: null };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[outbound] Failed to deliver chat reply: ${message}`);
    return { status: "FAILED", error: message };
  }

  return { status: "NOT_APPLICABLE", error: null };
}
