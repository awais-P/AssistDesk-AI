import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSlackCustomerMessage, verifySlackSignature } from "@/src/lib/integrations/slack";
import { parseWhatsAppMessages, verifyWhatsAppSignature } from "@/src/lib/integrations/whatsapp";

describe("Slack request signing", () => {
  const signingSecret = "8f742231b10e8888abcd99yyyzzz85a5";
  const rawBody = '{"type":"event_callback"}';
  const now = 1_760_000_000_000;
  const timestamp = String(now / 1000);
  const signature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;

  it("accepts a correctly signed, fresh request", () => {
    expect(verifySlackSignature({ signingSecret, timestamp, rawBody, signature, now })).toBe(true);
  });

  it("rejects wrong signatures, modified bodies and replayed requests", () => {
    expect(
      verifySlackSignature({ signingSecret, timestamp, rawBody: `${rawBody} `, signature, now }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret: "other", timestamp, rawBody, signature, now }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret, timestamp, rawBody, signature, now: now + 10 * 60 * 1000 }),
    ).toBe(false);
    expect(
      verifySlackSignature({ signingSecret, timestamp: null, rawBody, signature, now }),
    ).toBe(false);
  });
});

describe("Slack event parsing", () => {
  it("handles DMs and mentions, and ignores bots and edits", () => {
    expect(
      parseSlackCustomerMessage({
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        ts: "1.1",
        text: "Hi",
      }),
    ).toMatchObject({ conversationKey: "D1", threadTs: null, text: "Hi" });

    expect(
      parseSlackCustomerMessage({
        type: "app_mention",
        channel: "C1",
        user: "U1",
        ts: "2.2",
        text: "<@UBOT> where is my order?",
      }),
    ).toMatchObject({ conversationKey: "C1:2.2", threadTs: "2.2", text: "where is my order?" });

    expect(
      parseSlackCustomerMessage({
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        ts: "1",
        bot_id: "B1",
        text: "x",
      }),
    ).toBeNull();
    expect(
      parseSlackCustomerMessage({
        type: "message",
        channel_type: "im",
        channel: "D1",
        user: "U1",
        ts: "1",
        subtype: "message_changed",
        text: "x",
      }),
    ).toBeNull();
    expect(
      parseSlackCustomerMessage(
        { type: "message", channel_type: "im", channel: "D1", user: "UBOT", ts: "1", text: "x" },
        "UBOT",
      ),
    ).toBeNull();
  });
});

describe("WhatsApp webhooks", () => {
  const appSecret = "whatsapp-app-secret";
  const rawBody = '{"object":"whatsapp_business_account"}';

  it("verifies X-Hub-Signature-256", () => {
    const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

    expect(verifyWhatsAppSignature({ appSecret, rawBody, signature })).toBe(true);
    expect(verifyWhatsAppSignature({ appSecret, rawBody: `${rawBody}x`, signature })).toBe(false);
    expect(verifyWhatsAppSignature({ appSecret, rawBody, signature: null })).toBe(false);
  });

  it("extracts text messages for the configured number only", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "PN1" },
                contacts: [{ wa_id: "923001234567", profile: { name: "Ali" } }],
                messages: [
                  {
                    id: "wamid.1",
                    from: "923001234567",
                    type: "text",
                    text: { body: "Order status?" },
                  },
                  { id: "wamid.2", from: "923001234567", type: "image" },
                ],
              },
            },
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "OTHER" },
                messages: [{ id: "wamid.3", from: "1", type: "text", text: { body: "ignore" } }],
              },
            },
          ],
        },
      ],
    };
    const { messages, unsupported } = parseWhatsAppMessages(payload, "PN1");

    expect(messages).toEqual([
      { messageId: "wamid.1", from: "923001234567", name: "Ali", text: "Order status?" },
    ]);
    expect(unsupported.map((message) => message.messageId)).toEqual(["wamid.2"]);
  });
});
