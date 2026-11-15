import { describe, expect, it } from "vitest";
import {
  hasAnyIdentifier,
  normalizeEmail,
  normalizeIdentity,
  normalizePhone,
  normalizeVisitorId,
  whatsappIdToPhone,
} from "@/src/lib/contacts";
import {
  cleanReplySubject,
  normalizeMessageId,
  parseTicketReference,
  stripQuotedReply,
} from "@/src/lib/email-threading";
import { buildRetrievalQuery } from "@/src/lib/llm-runtime";
import { clampRateLimitPerMinute, formatRetryAfter, hashClientIp } from "@/src/lib/rate-limit";
import {
  CHANNEL_IDLE_MINUTES,
  MAX_WIDGET_SESSION_HOURS,
  clampSessionTimeoutMinutes,
  computeResolution,
  createSessionCredentials,
  getExpiryReason,
  getIdleTimeoutMinutes,
  getSessionExpiresAt,
  hashWidgetSessionToken,
} from "@/src/lib/session-lifecycle";
import {
  extractTaggedOutput,
  extractiveSummary,
  formatRelativeAge,
  formatTranscript,
  isVerifiedIdentity,
  maskEmail,
  maskPhone,
  redactIdentifiers,
} from "@/src/lib/session-memory";

const MINUTE = 60 * 1000;
const now = new Date("2026-09-29T12:00:00Z");

function session(overrides: Partial<Parameters<typeof getExpiryReason>[0]> = {}) {
  return {
    channel: "WEB_WIDGET",
    status: "ACTIVE",
    startedAt: new Date(now.getTime() - 10 * MINUTE),
    lastActivityAt: new Date(now.getTime() - 1 * MINUTE),
    chatbot: { sessionTimeoutMinutes: 30 },
    ...overrides,
  };
}

describe("UT-20 session expiration policies - FE-5", () => {
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * MINUTE);

  it("UT-20.01 keeps a recently active widget session open", () => {
    expect(getExpiryReason(session(), now)).toBeNull();
  });

  it("UT-20.02 closes a widget session after the chatbot's idle timeout", () => {
    const idle = session({ lastActivityAt: new Date(now.getTime() - 31 * MINUTE) });
    expect(getExpiryReason(idle, now)).toBe("IDLE_TIMEOUT");
  });

  it("UT-20.03 uses the chatbot's own timeout, clamped to 5–1440 minutes", () => {
    expect(getIdleTimeoutMinutes(session({ chatbot: { sessionTimeoutMinutes: 90 } }))).toBe(90);
    expect(getIdleTimeoutMinutes(session({ chatbot: { sessionTimeoutMinutes: 1 } }))).toBe(5);
    expect(getIdleTimeoutMinutes(session({ chatbot: { sessionTimeoutMinutes: 99999 } }))).toBe(1440);
    expect(clampSessionTimeoutMinutes("abc")).toBe(CHANNEL_IDLE_MINUTES.WEB_WIDGET);
  });

  it("UT-20.04 keeps a WhatsApp session open within 24 hours", () => {
    expect(getExpiryReason(session({ channel: "WHATSAPP", chatbot: null, lastActivityAt: hoursAgo(23) }), now)).toBeNull();
  });

  it("UT-20.05 expires a WhatsApp session after 24 hours", () => {
    expect(getExpiryReason(session({ channel: "WHATSAPP", chatbot: null, lastActivityAt: hoursAgo(25) }), now)).toBe("IDLE_TIMEOUT");
  });

  it("UT-20.06 expires a Slack session after 4 hours", () => {
    expect(getExpiryReason(session({ channel: "SLACK", chatbot: null, lastActivityAt: hoursAgo(5) }), now)).toBe("IDLE_TIMEOUT");
  });

  it("UT-20.07 keeps an email session open within 7 days", () => {
    expect(getExpiryReason(session({ channel: "EMAIL", chatbot: null, lastActivityAt: hoursAgo(24 * 6) }), now)).toBeNull();
  });

  it("UT-20.08 gives a human-handled, escalated chat at least an hour", () => {
    const escalated = session({ status: "ESCALATED", lastActivityAt: new Date(now.getTime() - 45 * MINUTE) });
    expect(getIdleTimeoutMinutes(escalated)).toBe(60);
    expect(getExpiryReason(escalated, now)).toBeNull();
  });

  it("UT-20.09 caps an always-active widget session at the maximum duration", () => {
    const long = session({ startedAt: new Date(now.getTime() - (MAX_WIDGET_SESSION_HOURS * 60 + 1) * MINUTE) });
    expect(getExpiryReason(long, now)).toBe("MAX_DURATION");
  });

  it("UT-20.10 never expires a closed session again and reports no deadline for it", () => {
    const closed = session({ status: "CLOSED", lastActivityAt: new Date(0) });
    expect(getExpiryReason(closed, now)).toBeNull();
    expect(getSessionExpiresAt(closed)).toBeNull();
  });

  it("UT-20.11 reports the earlier of the idle and the hard deadline", () => {
    const expiresAt = getSessionExpiresAt(session());
    expect(expiresAt?.getTime()).toBe(now.getTime() - 1 * MINUTE + 30 * MINUTE);
  });
});

describe("UT-21 session outcome and credentials", () => {
  it("UT-21.01 classifies how a session was resolved", () => {
    expect(computeResolution({ aiMessages: 3, agentMessages: 0, wasEscalated: false })).toBe("AI_RESOLVED");
    expect(computeResolution({ aiMessages: 3, agentMessages: 1, wasEscalated: false })).toBe("HUMAN_HANDLED");
    expect(computeResolution({ aiMessages: 0, agentMessages: 0, wasEscalated: true })).toBe("HUMAN_HANDLED");
    expect(computeResolution({ aiMessages: 0, agentMessages: 0, wasEscalated: false })).toBe("UNANSWERED");
  });

  it("UT-21.02 creates unguessable widget session tokens and stores only their hash", () => {
    const first = createSessionCredentials();
    const second = createSessionCredentials();

    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(43);
    expect(first.tokenHash).toBe(hashWidgetSessionToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("UT-22 customer identity normalisation - FE-2", () => {
  it("UT-22.01 normalises emails and rejects invalid ones", () => {
    expect(normalizeEmail("  Ali@Example.COM ")).toBe("ali@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("UT-22.02 matches the same phone number typed in different formats", () => {
    expect(normalizePhone("0300-1234567")).toBe("+923001234567");
    expect(normalizePhone("+92 300 1234567")).toBe("+923001234567");
    expect(normalizePhone("0092 300 1234567")).toBe("+923001234567");
    expect(whatsappIdToPhone("923001234567")).toBe("+923001234567");
    expect(normalizePhone("12")).toBeNull();
  });

  it("UT-22.03 treats a WhatsApp id as a verified phone number", () => {
    expect(normalizeIdentity({ whatsappId: "923001234567" })).toMatchObject({
      whatsappId: "923001234567",
      phone: "+923001234567",
    });
  });

  it("UT-22.04 accepts only well-formed anonymous visitor ids", () => {
    expect(normalizeVisitorId("3f2c9a1e-5b7d-4c1a-9e8f-0a1b2c3d4e5f")).toBe("3f2c9a1e-5b7d-4c1a-9e8f-0a1b2c3d4e5f");
    expect(normalizeVisitorId("short")).toBeNull();
    expect(normalizeVisitorId("<script>alert(1)</script>xxxxxxxx")).toBeNull();
  });

  it("UT-22.05 knows when there is nothing to identify the customer by", () => {
    expect(hasAnyIdentifier(normalizeIdentity({ name: "Ali" }))).toBe(false);
    expect(hasAnyIdentifier(normalizeIdentity({ slackUserId: "U123" }))).toBe(true);
  });
});

describe("UT-23 memory helpers - FE-3", () => {
  it("UT-23.01 masks personal details before they reach the prompt", () => {
    expect(maskEmail("ali.khan@example.com")).toBe("a***@example.com");
    expect(maskPhone("+923001234567")).toBe("*********4567");
  });

  it("UT-23.02 formats transcripts without system notices and keeps the newest part", () => {
    const transcript = formatTranscript([
      { sender: "USER", content: "Where is order 1042?" },
      { sender: "SYSTEM", content: "Ali joined" },
      { sender: "AI", content: "It ships tomorrow." },
    ]);

    expect(transcript).toBe("Customer: Where is order 1042?\nAI assistant: It ships tomorrow.");
    expect(formatTranscript([{ sender: "USER", content: "x".repeat(50) }], 10).startsWith("…")).toBe(true);
  });

  it("UT-23.03 falls back to an extractive summary when no model is available", () => {
    expect(
      extractiveSummary([
        { sender: "USER", content: "My refund for order 1042 is late" },
        { sender: "AI", content: "Refunds take 5 business days." },
      ]),
    ).toBe("Customer asked: My refund for order 1042 is late. Last reply: Refunds take 5 business days.");
    expect(extractiveSummary([{ sender: "AI", content: "Hello" }])).toBeNull();
  });

  it("UT-23.04 describes how long ago a conversation happened", () => {
    expect(formatRelativeAge(new Date(now.getTime() - 5 * MINUTE), now)).toBe("5 min ago");
    expect(formatRelativeAge(new Date(now.getTime() - 3 * 60 * MINUTE), now)).toBe("3 h ago");
    expect(formatRelativeAge(new Date(now.getTime() - 72 * 60 * MINUTE), now)).toBe("3 days ago");
  });

  it("UT-23.05 uses the previous question to retrieve knowledge for short follow-ups", () => {
    const history = [
      { role: "user" as const, content: "What is your refund policy for damaged items?" },
      { role: "assistant" as const, content: "Damaged items can be refunded within 30 days." },
    ];

    expect(buildRetrievalQuery("and for gifts?", history)).toContain("refund policy");
    expect(buildRetrievalQuery("Can I change the delivery address after the order has shipped?", history)).toBe(
      "Can I change the delivery address after the order has shipped?",
    );
  });
});

describe("UT-24 memory privacy and output hygiene", () => {
  it("UT-24.01 treats provider identities and the customer's own browser as verified", () => {
    expect(isVerifiedIdentity({ channel: "WHATSAPP", visitorId: null, contact: null })).toBe(true);
    expect(isVerifiedIdentity({ channel: "WEB_WIDGET", visitorId: "browser-a", contact: { visitorId: "browser-a" } })).toBe(true);
    // Someone else typed the customer's email on another device.
    expect(isVerifiedIdentity({ channel: "WEB_WIDGET", visitorId: "browser-b", contact: { visitorId: "browser-a" } })).toBe(false);
    expect(isVerifiedIdentity({ channel: "WEB_WIDGET", visitorId: null, contact: { visitorId: "browser-a" } })).toBe(false);
  });

  it("UT-24.02 redacts identifiers for unverified visitors but keeps dates and context", () => {
    const redacted = redactIdentifiers(
      "Known customer (email a***@example.com, phone *********4567). 2026-09-29: order #1042 for a blue kettle, ticket AD-458105, call +92 300 1234567.",
    );

    expect(redacted).not.toMatch(/1042|458105|4567|example\.com|300 1234567/);
    expect(redacted).toContain("2026-09-29");
    expect(redacted).toContain("blue kettle");
    expect(redacted).toContain("[number hidden]");
    expect(redacted).toContain("[email hidden]");
  });

  it("UT-24.03 keeps only the tagged answer from a model reply", () => {
    expect(extractTaggedOutput("<think>plan…</think><summary>Customer asked about a refund.</summary>", "summary")).toBe(
      "Customer asked about a refund.",
    );
    expect(extractTaggedOutput("We need to write a profile. <profile>Ali, kettle order.</profile>", "profile")).toBe(
      "Ali, kettle order.",
    );
    expect(extractTaggedOutput("Customer asked about a refund.", "summary")).toBe("Customer asked about a refund.");
  });

  it("UT-24.04 rejects replies that are the model thinking out loud", () => {
    expect(extractTaggedOutput("We need to write a customer profile for the support team, max 100 words…", "profile")).toBeNull();
    expect(extractTaggedOutput("<summary></summary>", "summary")).toBeNull();
    expect(extractTaggedOutput(null, "summary")).toBeNull();
  });
});

describe("UT-25 email threading", () => {
  it("UT-25.01 finds the ticket reference in a reply subject", () => {
    expect(parseTicketReference("Re: Refund request [AD-458103]")).toEqual({ prefix: "AD", ticketNumber: 458103 });
    expect(parseTicketReference("Re: [sup-12] help")).toEqual({ prefix: "SUP", ticketNumber: 12 });
    expect(parseTicketReference("Refund request")).toBeNull();
  });

  it("UT-25.02 cleans reply prefixes and the reference from the subject", () => {
    expect(cleanReplySubject("RE: Fwd: Re: Refund request [AD-458103]")).toBe("Refund request");
  });

  it("UT-25.03 keeps only the new part of a reply", () => {
    const reply = [
      "Thanks, but it still hasn't arrived.",
      "",
      "On Mon, 28 Sep 2026 at 10:00, Support <support@example.com> wrote:",
      "> Your refund was processed.",
    ].join("\n");

    expect(stripQuotedReply(reply)).toBe("Thanks, but it still hasn't arrived.");
    expect(stripQuotedReply("> only quoted text")).toBe("> only quoted text");
  });

  it("UT-25.04 normalises Message-IDs", () => {
    expect(normalizeMessageId(" <abc123@mail.example.com> ")).toBe("abc123@mail.example.com");
    expect(normalizeMessageId("")).toBeNull();
  });
});

describe("UT-26 rate limiting helpers - FE-6", () => {
  it("UT-26.01 clamps the chatbot's per-minute limit", () => {
    expect(clampRateLimitPerMinute(0)).toBe(1);
    expect(clampRateLimitPerMinute(500)).toBe(120);
    expect(clampRateLimitPerMinute("x")).toBe(10);
  });

  it("UT-26.02 never stores raw IP addresses", () => {
    const hash = hashClientIp("203.0.113.7");
    expect(hash).not.toContain("203.0.113.7");
    expect(hash).toBe(hashClientIp("203.0.113.7"));
    expect(hash).not.toBe(hashClientIp("203.0.113.8"));
  });

  it("UT-26.03 formats the wait time for the customer", () => {
    expect(formatRetryAfter(1)).toBe("1 second");
    expect(formatRetryAfter(45)).toBe("45 seconds");
    expect(formatRetryAfter(125)).toBe("3 minutes");
  });
});
