import { prisma } from "../prisma";
import { getAppUrl } from "../llm-runtime";
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
/**
 * WhatsApp and Slack get a team member's attachments as download links under the text
 * (FR-6.6); stored files are public at their address, so the customer can open them.
 */
export function withAttachmentLinks(content: string, attachments: Array<{ url: string; name: string }> = []) {
  if (attachments.length === 0) {
    return content;
  }

  const base = getAppUrl();
  const links = attachments.map((attachment) => `📎 ${attachment.name}: ${attachment.url.startsWith("/") ? `${base}${attachment.url}` : attachment.url}`);
  return [content, ...links].filter(Boolean).join("\n");
}

export async function deliverAgentMessageToChannel(
  sessionId: string,
  rawContent: string,
  attachments: Array<{ url: string; name: string }> = [],
): Promise<ChannelDeliveryResult> {
  const content = withAttachmentLinks(rawContent, attachments);
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
