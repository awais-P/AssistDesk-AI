import { createHmac } from "node:crypto";
import { safeEqual } from "../secrets";

const SLACK_API = "https://slack.com/api";
const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

export type SlackConfig = {
  botToken: string;
  signingSecret: string;
  botUserId?: string;
  teamName?: string;
};

/**
 * Verifies the X-Slack-Signature header (HMAC-SHA256 of `v0:{timestamp}:{body}`).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature({
  signingSecret,
  timestamp,
  rawBody,
  signature,
  now = Date.now(),
}: {
  signingSecret: string;
  timestamp: string | null;
  rawBody: string;
  signature: string | null;
  now?: number;
}) {
  if (!timestamp || !signature) {
    return false;
  }

  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));

  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;

  return safeEqual(expected, signature);
}

async function slackApi<T>(method: string, token: string, body?: Record<string, unknown>) {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as T & { ok: boolean; error?: string };

  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error ?? response.status}`);
  }

  return data;
}

export async function testSlackConnection(botToken: string) {
  const data = await slackApi<{ team_id: string; team: string; user_id: string; bot_id?: string }>(
    "auth.test",
    botToken,
  );

  return {
    teamId: data.team_id,
    teamName: data.team,
    botUserId: data.user_id,
  };
}

export async function postSlackMessage({
  botToken,
  channel,
  text,
  threadTs,
}: {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string | null;
}) {
  await slackApi("chat.postMessage", botToken, {
    channel,
    text: text.slice(0, 39_000),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

/**
 * Name and (with the users:read.email scope) email of a Slack user. The email lets
 * AssistDesk recognise the same customer on the website or by email (Module 5).
 */
export async function getSlackUserProfile(botToken: string, userId: string) {
  try {
    const data = await slackApi<{
      user?: {
        real_name?: string;
        profile?: { display_name?: string; real_name?: string; email?: string };
      };
    }>("users.info", botToken, { user: userId });

    return {
      name:
        data.user?.profile?.display_name ||
        data.user?.profile?.real_name ||
        data.user?.real_name ||
        null,
      email: data.user?.profile?.email ?? null,
    };
  } catch {
    // users:read / users:read.email scopes are optional.
    return { name: null, email: null };
  }
}

export type SlackMessageEvent = {
  type: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
};

/**
 * Turns a Slack event into a customer message, or null if it should be ignored
 * (bot messages, edits, joins, messages from the app itself).
 */
export function parseSlackCustomerMessage(event: SlackMessageEvent, botUserId?: string) {
  if (!event.channel || !event.user || !event.ts || event.bot_id || event.subtype) {
    return null;
  }

  if (botUserId && event.user === botUserId) {
    return null;
  }

  const isDirectMessage = event.type === "message" && event.channel_type === "im";
  const isMention = event.type === "app_mention";

  if (!isDirectMessage && !isMention) {
    return null;
  }

  const text = (event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();

  if (!text) {
    return null;
  }

  const threadTs = isMention ? event.thread_ts || event.ts : null;

  return {
    text,
    userId: event.user,
    channel: event.channel,
    threadTs,
    // A DM is one conversation; a mention thread in a channel is its own conversation.
    conversationKey: isMention ? `${event.channel}:${threadTs}` : event.channel,
  };
}
