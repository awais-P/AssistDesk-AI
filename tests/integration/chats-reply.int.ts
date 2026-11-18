import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * The Chats reply box (FR-6.2, FR-6.6): a team member attaches files to a reply, the
 * reply can be files only, foreign or extra files are refused, and the live Chats stream
 * reports which website visitors have the chat open.
 */

type SessionUser = { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null };
const signedIn: { current: { user: SessionUser } | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const attachmentsRoute = await import("@/app/api/chat-attachments/route");
const replyRoute = await import("@/app/api/chat-sessions/[id]/messages/route");
const eventsRoute = await import("@/app/api/chat-sessions/events/route");
const { markVisitorSeen, resetVisitorPresenceForTests } = await import("@/src/lib/visitor-presence");

const suffix = Date.now().toString(36);
let workspaceId = "";
let sessionId = "";
const storedFiles: string[] = [];
// A 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function upload(file: File) {
  const form = new FormData();
  form.set("file", file);
  return attachmentsRoute.POST(new Request("http://localhost/api/chat-attachments", { method: "POST", body: form }));
}

const reply = (body: Record<string, unknown>) =>
  replyRoute.POST(
    new Request(`http://localhost/api/chat-sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );

beforeAll(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
  const workspace = await prisma.workspace.create({
    data: { name: `Chats ${suffix}`, slug: `chats-${suffix}`, supportEmail: `chats-${suffix}@example.com`, settings: { create: {} } },
  });
  workspaceId = workspace.id;
  const agent = await prisma.user.create({
    data: { workspaceId, fullName: "Sara Agent", username: `chats-agent-${suffix}`, email: `chats-agent-${suffix}@example.com`, role: "AGENT", isEmailVerified: true },
  });
  signedIn.current = { user: { id: agent.id, role: "AGENT", workspaceId, fullName: "Sara Agent", email: agent.email, customRole: null } };
  sessionId = (await prisma.chatSession.create({ data: { workspaceId, channel: "WEB_WIDGET", customerName: "Ali Khan" } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  resetVisitorPresenceForTests();
  await Promise.all(storedFiles.map((url) => rm(path.join(process.cwd(), "storage", "uploads", url.replace("/api/uploads/", "")), { force: true })));
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
});

describe("IT-32 Chats reply box (FR-6.2, FR-6.6)", () => {
  it("IT-32.01 only team members can upload, and only images and documents up to 5 MB", async () => {
    const saved = signedIn.current;
    signedIn.current = null;
    expect((await upload(new File([PNG], "photo.png", { type: "image/png" }))).status).toBe(401);
    signedIn.current = saved;

    expect((await upload(new File(["MZ"], "tool.exe", { type: "application/x-msdownload" }))).status).toBe(400);
    expect((await upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }))).status).toBe(400);

    const response = await upload(new File([PNG], "photo.png", { type: "image/png" }));
    expect(response.status).toBe(200);
    const { attachment } = (await response.json()) as { attachment: { url: string; name: string; mimeType: string; size: number } };
    storedFiles.push(attachment.url);
    expect(attachment).toMatchObject({ name: "photo.png", mimeType: "image/png", size: PNG.length });
    expect(attachment.url).toMatch(/^\/api\/uploads\/attachments\/[a-f0-9]{32}\.png$/);
  });

  it("IT-32.02 a reply can be files only; the files are saved with the message", async () => {
    const { attachment } = (await (await upload(new File([PNG], "label.png", { type: "image/png" }))).json()) as { attachment: { url: string } };
    storedFiles.push(attachment.url);

    const response = await reply({ content: "", attachments: [attachment] });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { message: { id: string; attachments: Array<{ url: string }> } };
    expect(data.message.attachments.map((item) => item.url)).toEqual([attachment.url]);
    const stored = await prisma.chatMessage.findUniqueOrThrow({ where: { id: data.message.id } });
    expect(stored).toMatchObject({ sender: "AGENT", authorName: "Sara Agent" });
    expect(stored.attachments).toEqual([expect.objectContaining({ url: attachment.url, name: "label.png" })]);
  });

  it("IT-32.03 files from elsewhere, or more than three, are refused", async () => {
    expect((await reply({ content: "See this", attachments: [{ url: "https://evil.example.com/x.png", name: "x.png", mimeType: "image/png" }] })).status).toBe(400);
    const own = { url: "/api/uploads/attachments/0123456789abcdef0123456789abcdef.png", name: "a.png", mimeType: "image/png", size: 10 };
    expect((await reply({ content: "Four", attachments: [own, own, own, own] })).status).toBe(400);
    expect((await reply({ content: "" })).status).toBe(400);
  });

  it("IT-32.04 the live Chats stream reports which visitors have the chat open", async () => {
    markVisitorSeen(sessionId, workspaceId);
    const controller = new AbortController();
    const response = await eventsRoute.GET(new Request("http://localhost/api/chat-sessions/events", { signal: controller.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";

    while (!text.includes("event: presence")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }

    controller.abort();
    await reader.cancel().catch(() => undefined);
    const event = text.slice(text.indexOf("event: presence"));
    const data = JSON.parse(event.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as { online: string[] };
    expect(data.online).toEqual([sessionId]);
  });
});
