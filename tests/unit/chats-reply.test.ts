import { afterEach, describe, expect, it, vi } from "vitest";
import { withAttachmentLinks } from "@/src/lib/integrations/channel-outbound";
import {
  VISITOR_ONLINE_WINDOW_MS,
  markVisitorGone,
  markVisitorSeen,
  onlineVisitorSessions,
  resetVisitorPresenceForTests,
} from "@/src/lib/visitor-presence";

afterEach(() => {
  vi.unstubAllEnvs();
  resetVisitorPresenceForTests();
});

describe("UT-69 Chats: customer presence and agent attachments (FR-6.2, FR-6.6)", () => {
  it("UT-69.01 a visitor is online while the widget checks in, and offline 30 s after it stops", () => {
    const now = Date.now();
    markVisitorSeen("chat-a", "ws-1", now);
    markVisitorSeen("chat-b", "ws-1", now - VISITOR_ONLINE_WINDOW_MS - 1);
    markVisitorSeen("chat-c", "ws-2", now);

    expect(onlineVisitorSessions("ws-1", now)).toEqual(["chat-a"]);
    expect(onlineVisitorSessions("ws-2", now)).toEqual(["chat-c"]); // other workspaces stay apart
    expect(onlineVisitorSessions("ws-1", now + VISITOR_ONLINE_WINDOW_MS + 1)).toEqual([]);

    markVisitorSeen("chat-a", "ws-1", now);
    markVisitorGone("chat-a");
    expect(onlineVisitorSessions("ws-1", now)).toEqual([]);
  });

  it("UT-69.02 WhatsApp and Slack customers get a team member's files as links under the text", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://assistdesk.example.com");

    expect(withAttachmentLinks("Here is your invoice.", [])).toBe("Here is your invoice.");
    expect(
      withAttachmentLinks("Here is your invoice.", [
        { url: "/api/uploads/attachments/0123456789abcdef0123456789abcdef.pdf", name: "invoice.pdf" },
        { url: "https://res.cloudinary.com/demo/image/upload/label.png", name: "label.png" },
      ]),
    ).toBe(
      "Here is your invoice.\n📎 invoice.pdf: https://assistdesk.example.com/api/uploads/attachments/0123456789abcdef0123456789abcdef.pdf\n📎 label.png: https://res.cloudinary.com/demo/image/upload/label.png",
    );
    expect(withAttachmentLinks("", [{ url: "/api/uploads/attachments/x.png", name: "photo.png" }])).toBe(
      "📎 photo.png: https://assistdesk.example.com/api/uploads/attachments/x.png",
    );
  });
});
