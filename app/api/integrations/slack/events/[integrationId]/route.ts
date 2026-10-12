import { NextResponse, after } from "next/server";
import { handleChannelInbound } from "@/src/lib/integrations/channel-inbound";
import { readIntegrationConfig } from "@/src/lib/integrations/config";
import {
  type SlackMessageEvent,
  getSlackUserProfile,
  parseSlackCustomerMessage,
  postSlackMessage,
  verifySlackSignature,
} from "@/src/lib/integrations/slack";
import { prisma } from "@/src/lib/prisma";

type SlackEventsRouteContext = {
  params: Promise<{
    integrationId: string;
  }>;
};

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: SlackMessageEvent;
};

/**
 * Slack Events API endpoint (one URL per AssistDesk Slack integration).
 * Configure it under "Event Subscriptions" and subscribe to message.im and app_mention.
 */
export async function POST(request: Request, context: SlackEventsRouteContext) {
  const { integrationId } = await context.params;
  const rawBody = await request.text();

  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, type: "SLACK" },
    select: {
      id: true,
      workspaceId: true,
      agentId: true,
      name: true,
      isActive: true,
      externalId: true,
      config: true,
    },
  });

  if (!integration) {
    return NextResponse.json({ error: "Unknown integration." }, { status: 404 });
  }

  const config = readIntegrationConfig("SLACK", integration.config);

  if (
    !config.signingSecret ||
    !verifySlackSignature({
      signingSecret: config.signingSecret,
      timestamp: request.headers.get("x-slack-request-timestamp"),
      signature: request.headers.get("x-slack-signature"),
      rawBody,
    })
  ) {
    return NextResponse.json({ error: "Invalid Slack signature." }, { status: 401 });
  }

  let envelope: SlackEnvelope;

  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge });
  }

  if (
    envelope.type !== "event_callback" ||
    !envelope.event ||
    !integration.isActive ||
    (integration.externalId && envelope.team_id && envelope.team_id !== integration.externalId)
  ) {
    return NextResponse.json({ ok: true });
  }

  const message = parseSlackCustomerMessage(envelope.event, config.botUserId);

  if (!message || !config.botToken) {
    return NextResponse.json({ ok: true });
  }

  // Slack expects a response within 3 seconds, so the AI reply runs after we ack.
  after(async () => {
    try {
      const profile = await getSlackUserProfile(config.botToken, message.userId);
      const customerName = profile.name;

      await handleChannelInbound({
        integration,
        channel: "SLACK",
        conversationKey: message.conversationKey,
        externalMessageId: `slack:${envelope.event_id ?? `${message.channel}:${envelope.event?.ts}`}`,
        identity: { slackUserId: message.userId, email: profile.email, name: customerName },
        customerName: customerName ?? `Slack user ${message.userId}`,
        text: message.text,
        deliver: (reply) =>
          postSlackMessage({
            botToken: config.botToken,
            channel: message.channel,
            text: reply,
            threadTs: message.threadTs,
          }),
      });
    } catch (error) {
      console.error("[slack] Failed to handle event:", error);
    }
  });

  return NextResponse.json({ ok: true });
}
