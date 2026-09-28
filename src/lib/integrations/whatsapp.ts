import { createHmac } from "node:crypto";
import { safeEqual } from "../secrets";

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
};

function graphUrl(path: string) {
  const version = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  return `https://graph.facebook.com/${version}/${path}`;
}

/**
 * Verifies the X-Hub-Signature-256 header Meta sends with every webhook
 * (HMAC-SHA256 of the raw body using the app secret).
 */
export function verifyWhatsAppSignature({
  appSecret,
  rawBody,
  signature,
}: {
  appSecret: string;
  rawBody: string;
  signature: string | null;
}) {
  if (!signature) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signature);
}

async function graphRequest<T>(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(graphUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${data.error?.message ?? response.status}`);
  }

  return data;
}

export async function testWhatsAppConnection(accessToken: string, phoneNumberId: string) {
  const data = await graphRequest<{ display_phone_number?: string; verified_name?: string }>(
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    accessToken,
  );

  return {
    displayPhoneNumber: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
  };
}

export async function sendWhatsAppText({
  accessToken,
  phoneNumberId,
  to,
  text,
}: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  text: string;
}) {
  await graphRequest(`${encodeURIComponent(phoneNumberId)}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text.slice(0, 4096) },
    }),
  });
}

type WhatsAppWebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: WhatsAppWebhookMessage[];
      };
    }>;
  }>;
};

export type WhatsAppInboundMessage = {
  messageId: string;
  from: string;
  name: string | null;
  text: string;
};

function messageText(message: WhatsAppWebhookMessage) {
  if (message.type === "text") {
    return message.text?.body ?? "";
  }

  if (message.type === "button") {
    return message.button?.text ?? "";
  }

  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? ""
    );
  }

  return "";
}

/**
 * Extracts customer text messages for one phone number from a webhook payload.
 * Status updates and unsupported media are skipped.
 */
export function parseWhatsAppMessages(
  payload: WhatsAppWebhookPayload,
  phoneNumberId: string,
): { messages: WhatsAppInboundMessage[]; unsupported: WhatsAppInboundMessage[] } {
  const messages: WhatsAppInboundMessage[] = [];
  const unsupported: WhatsAppInboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      if (change.field !== "messages" || value?.metadata?.phone_number_id !== phoneNumberId) {
        continue;
      }

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) {
          continue;
        }

        const contact = value.contacts?.find((item) => item.wa_id === message.from);
        const parsed = {
          messageId: message.id,
          from: message.from,
          name: contact?.profile?.name ?? null,
          text: messageText(message).trim(),
        };

        if (parsed.text) {
          messages.push(parsed);
        } else {
          unsupported.push(parsed);
        }
      }
    }
  }

  return { messages, unsupported };
}
