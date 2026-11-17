import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";
import { WIDGET_TOKEN_HEADER, createWidgetToken } from "@/src/lib/widget-token";

/**
 * Token streaming end to end (M5 / M6 FE-5): the website chat and the Playground send the
 * AI reply piece by piece when the client asks for it, the stored reply is the streamed
 * text, the time to the first word is recorded, and old clients still get one JSON reply.
 * The AI provider is replaced by a scripted streaming endpoint.
 */

type SessionUser = { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null };
const signedIn: { current: { user: SessionUser } | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const messagesRoute = await import("@/app/api/widget/[widgetId]/messages/route");
const playgroundRoute = await import("@/app/api/ai-agents/[id]/playground/route");

const suffix = Date.now().toString(36);
const encoder = new TextEncoder();
let workspaceId = "";
let agentId = "";
let widgetId = "";
let visitor = 0;

/** What the scripted provider answers: pieces, or a failure. */
const provider: { pieces: string[]; fail: boolean; calls: number } = { pieces: [], fail: false, calls: 0 };

function providerResponse(init?: RequestInit) {
  provider.calls += 1;

  if (provider.fail) {
    return new Response(JSON.stringify({ error: { message: "upstream overloaded" } }), { status: 503 });
  }

  // A request without `stream: true` gets the whole reply at once, like the real API.
  if (!JSON.parse(String(init?.body ?? "{}")).stream) {
    return Response.json({ choices: [{ message: { content: provider.pieces.join("") } }], usage: { total_tokens: 30 } });
  }

  let index = 0;
  const lines = [
    ...provider.pieces.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 30 } })}\n\n`,
    "data: [DONE]\n\n",
  ];

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (index >= lines.length) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 5)); // a model writing
        controller.enqueue(encoder.encode(lines[index]));
        index += 1;
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

type StreamEvent = { type: string } & Record<string, unknown>;

async function readEvents(response: Response) {
  return (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent);
}

function widgetRequest(message: string, { stream = true } = {}) {
  visitor += 1;
  return new Request(`http://localhost/api/widget/${widgetId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(stream ? { Accept: "application/x-ndjson, application/json" } : {}),
      [WIDGET_TOKEN_HEADER]: createWidgetToken(widgetId, "shop.example.com"),
      "x-forwarded-for": `198.51.100.${visitor}`,
    },
    body: JSON.stringify({ message, customerEmail: `visitor${visitor}-${suffix}@example.com` }),
  });
}

const sendToWidget = (request: Request) => messagesRoute.POST(request, { params: Promise.resolve({ widgetId }) });

beforeAll(async () => {
  const workspace = await prisma.workspace.create({
    data: { name: `Streaming ${suffix}`, slug: `streaming-${suffix}`, supportEmail: `streaming-${suffix}@example.com`, settings: { create: {} } },
  });
  workspaceId = workspace.id;
  agentId = (
    await prisma.aIAgent.create({
      data: { workspaceId, name: "Stream agent", provider: "Default", model: "openrouter/google/gemma-4-31b-it:free", status: "ACTIVE" },
    })
  ).id;
  widgetId = `stream-${suffix}`;
  await prisma.chatbot.create({ data: { workspaceId, agentId, name: "Shop chat", widgetId, allowedDomains: ["shop.example.com"] } });
  const owner = await prisma.user.create({
    data: { workspaceId, fullName: "Owner", username: `stream-owner-${suffix}`, email: `stream-owner-${suffix}@example.com`, role: "OWNER", isEmailVerified: true },
  });
  signedIn.current = { user: { id: owner.id, role: "OWNER", workspaceId, fullName: "Owner", email: owner.email, customRole: null } };
});

beforeEach(() => {
  vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "fake-openrouter-key-for-tests");
  vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "");
  vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
  provider.pieces = [];
  provider.fail = false;
  provider.calls = 0;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
    String(url).startsWith("https://openrouter.ai/api/v1/chat/completions") ? providerResponse(init) : realFetch(url, init),
  );
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
});

describe("IT-30 token streaming of AI replies (M5 / M6 FE-5)", () => {
  it("IT-30.01 the website chat streams the reply: start, pieces, then the saved message", async () => {
    provider.pieces = ["Orders ship ", "within one ", "business day."];
    const response = await sendToWidget(widgetRequest("How fast do you ship?"));

    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const events = await readEvents(response);
    expect(events[0]).toMatchObject({ type: "start", sessionStarted: true });
    expect((events[0].messages as Array<{ sender: string }>)[0].sender).toBe("USER");
    expect(typeof events[0].sessionToken).toBe("string");

    const deltas = events.filter((event) => event.type === "delta").map((event) => event.text);
    expect(deltas.join("")).toBe("Orders ship within one business day.");
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    const reply = (done.messages as Array<{ sender: string; content: string; id: string }>).find((message) => message.sender === "AI");
    expect(reply?.content).toBe("Orders ship within one business day.");
    expect(done.firstTokenMs).toEqual(expect.any(Number));

    const stored = await prisma.aiInteraction.findUnique({ where: { messageId: reply!.id } });
    expect(stored?.firstTokenMs).toEqual(expect.any(Number));
    expect(stored!.firstTokenMs!).toBeLessThanOrEqual(stored!.latencyMs + 50);
  });

  it("IT-30.02 a client that does not ask for streaming gets one JSON reply, as before", async () => {
    provider.pieces = ["Returns are free ", "for 30 days."];
    const response = await sendToWidget(widgetRequest("Can I return it?", { stream: false }));

    expect(response.headers.get("Content-Type")).toContain("application/json");
    const data = (await response.json()) as { messages: Array<{ sender: string; content: string }> };
    expect(data.messages.map((message) => message.sender)).toEqual(["USER", "AI"]);
    expect(data.messages[1].content).toBe("Returns are free for 30 days.");
  });

  it("IT-30.03 when every model fails, the stream still ends with the saved fallback reply", async () => {
    provider.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events = await readEvents(await sendToWidget(widgetRequest("Do you sell gift cards?")));

    expect(provider.calls).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "delta")).toHaveLength(0);
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    const reply = (done.messages as Array<{ sender: string; content: string }>).find((message) => message.sender === "AI");
    expect(reply?.content.length).toBeGreaterThan(0);
    expect(done.firstTokenMs).toBeNull();
  });

  it("IT-30.04 the Playground streams too and reports the time to the first word", async () => {
    provider.pieces = ["Hello! ", "How can I help?"];
    const response = await playgroundRoute.POST(
      new Request(`http://localhost/api/ai-agents/${agentId}/playground`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson, application/json" },
        body: JSON.stringify({ message: "Hi", history: [] }),
      }),
      { params: Promise.resolve({ id: agentId }) },
    );

    const events = await readEvents(response);
    expect(events[0].type).toBe("start");
    // A reply this short is held back by the moderation guard and released in one piece.
    expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toBe("Hello! How can I help?");
    const done = events.at(-1)!;
    expect(done).toMatchObject({ reply: "Hello! How can I help?", usedFallback: false });
    expect(done.firstTokenMs).toEqual(expect.any(Number));
    expect(done.firstTokenMs as number).toBeLessThanOrEqual(done.latencyMs as number);
  });
});
