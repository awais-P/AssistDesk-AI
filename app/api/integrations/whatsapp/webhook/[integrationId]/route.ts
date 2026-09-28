import { NextResponse, after } from "next/server";
import { handleChannelInbound } from "@/src/lib/integrations/channel-inbound";
import { readIntegrationConfig } from "@/src/lib/integrations/config";
import {
  parseWhatsAppMessages,
  sendWhatsAppText,
  verifyWhatsAppSignature,
} from "@/src/lib/integrations/whatsapp";
import { prisma } from "@/src/lib/prisma";
import { safeEqual } from "@/src/lib/secrets";

type WhatsAppWebhookRouteContext = {
  params: Promise<{
    integrationId: string;
  }>;
};

async function findWhatsAppIntegration(integrationId: string) {
  return prisma.integration.findFirst({
    where: { id: integrationId, type: "WHATSAPP" },
    select: {
      id: true,
      workspaceId: true,
      agentId: true,
      name: true,
      isActive: true,
      webhookSecret: true,
      config: true,
    },
  });
}

/** Meta webhook verification handshake (hub.challenge). */
export async function GET(request: Request, context: WhatsAppWebhookRouteContext) {
  const { integrationId } = await context.params;
  const url = new URL(request.url);
  const integration = await findWhatsAppIntegration(integrationId);
  const verifyToken = url.searchParams.get("hub.verify_token") || "";

  if (
    !integration?.webhookSecret ||
    url.searchParams.get("hub.mode") !== "subscribe" ||
    !safeEqual(verifyToken, integration.webhookSecret)
  ) {
    return new Response("Verification failed", { status: 403 });
  }

  return new Response(url.searchParams.get("hub.challenge") || "", {
    headers: { "Content-Type": "text/plain" },
  });
}

/** WhatsApp Cloud API message webhook. */
export async function POST(request: Request, context: WhatsAppWebhookRouteContext) {
  const { integrationId } = await context.params;
  const rawBody = await request.text();
  const integration = await findWhatsAppIntegration(integrationId);

  if (!integration) {
    return NextResponse.json({ error: "Unknown integration." }, { status: 404 });
  }

  const config = readIntegrationConfig("WHATSAPP", integration.config);

  if (
    !config.appSecret ||
    !verifyWhatsAppSignature({
      appSecret: config.appSecret,
      rawBody,
      signature: request.headers.get("x-hub-signature-256"),
    })
  ) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Parameters<typeof parseWhatsAppMessages>[0];

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!integration.isActive || !config.phoneNumberId || !config.accessToken) {
    return NextResponse.json({ ok: true });
  }

  const { messages, unsupported } = parseWhatsAppMessages(payload, config.phoneNumberId);

  // Meta retries webhooks that are slow to respond, so replies are sent after the ack.
  after(async () => {
    for (const message of messages) {
      try {
        await handleChannelInbound({
          integration,
          channel: "WHATSAPP",
          conversationKey: message.from,
          externalMessageId: `wa:${message.messageId}`,
          customerName: message.name,
          customerPhone: `+${message.from}`,
          text: message.text,
          deliver: (reply) =>
            sendWhatsAppText({
              accessToken: config.accessToken,
              phoneNumberId: config.phoneNumberId,
              to: message.from,
              text: reply,
            }),
        });
      } catch (error) {
        console.error("[whatsapp] Failed to handle message:", error);
      }
    }

    for (const message of unsupported) {
      await sendWhatsAppText({
        accessToken: config.accessToken,
        phoneNumberId: config.phoneNumberId,
        to: message.from,
        text: "Sorry, I can only read text messages right now. Please type your question.",
      }).catch((error) => console.error("[whatsapp] Failed to send notice:", error));
    }
  });

  return NextResponse.json({ ok: true });
}
