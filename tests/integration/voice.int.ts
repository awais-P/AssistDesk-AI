import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";
import { WIDGET_TOKEN_HEADER, createWidgetToken } from "@/src/lib/widget-token";

/**
 * Voice channel end to end (M6 FE-6..8, FR-16.6, M5 FE-2): starting a call from the widget,
 * the call as its own VOICE conversation under the same customer, a spoken turn through
 * the streaming reply, the measured time to the first audio, renewing the token and
 * hanging up. Deepgram's token endpoint and the AI provider are simulated.
 */

const voiceRoute = await import("@/app/api/widget/[widgetId]/voice/route");
const messagesRoute = await import("@/app/api/widget/[widgetId]/messages/route");
const configRoute = await import("@/app/api/widget/[widgetId]/route");
const { loadAnalyticsDashboard, parseAnalyticsRange } = await import("@/src/lib/analytics");

const suffix = Date.now().toString(36);
const encoder = new TextEncoder();
let workspaceId = "";
let agentId = "";
let widgetId = "";
let visitor = 0;
const providerPrompts: string[] = [];
const grants: Array<RequestInit | undefined> = [];

function aiStream(pieces: string[]) {
  const lines = [...pieces.map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`), "data: [DONE]\n\n"];
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= lines.length) controller.close();
        else controller.enqueue(encoder.encode(lines[index++]));
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

type Event = { type: string } & Record<string, unknown>;
const readEvents = async (response: Response) =>
  (await response.text()).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Event);

function widgetHeaders(sessionToken?: string | null, extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    [WIDGET_TOKEN_HEADER]: createWidgetToken(widgetId, "shop.example.com"),
    "x-forwarded-for": `198.51.100.${(visitor % 200) + 1}`,
    ...(sessionToken ? { "x-assistdesk-session-token": sessionToken } : {}),
    ...extra,
  };
}

const voice = (body: Record<string, unknown>, sessionToken?: string | null) =>
  voiceRoute.POST(new Request(`http://localhost/api/widget/${widgetId}/voice`, { method: "POST", headers: widgetHeaders(sessionToken), body: JSON.stringify(body) }), {
    params: Promise.resolve({ widgetId }),
  });
const say = (message: string, sessionToken: string | null, voiceTurn = true) =>
  messagesRoute.POST(
    new Request(`http://localhost/api/widget/${widgetId}/messages`, {
      method: "POST",
      headers: widgetHeaders(sessionToken, { Accept: "application/x-ndjson, application/json" }),
      body: JSON.stringify({ message, voice: voiceTurn, customerEmail: `caller-${suffix}@example.com`, customerName: "Caller" }),
    }),
    { params: Promise.resolve({ widgetId }) },
  );

beforeAll(async () => {
  const workspace = await prisma.workspace.create({
    data: { name: `Voice ${suffix}`, slug: `voice-${suffix}`, supportEmail: `voice-${suffix}@example.com`, settings: { create: {} } },
  });
  workspaceId = workspace.id;
  agentId = (await prisma.aIAgent.create({ data: { workspaceId, name: "Voice agent", provider: "Default", model: "openrouter/google/gemma-4-31b-it:free", status: "ACTIVE" } })).id;
  widgetId = `voice-${suffix}`;
  await prisma.chatbot.create({ data: { workspaceId, agentId, name: "Shop chat", widgetId, allowedDomains: ["shop.example.com"], voiceEnabled: true } });
});

beforeEach(() => {
  visitor += 1;
  vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key-for-tests");
  vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "fake-openrouter-key-for-tests");
  vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "");
  vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const address = String(url);

    if (address === "https://api.deepgram.com/v1/auth/grant") {
      grants.push(init);
      return Response.json({ access_token: `temporary-jwt-${grants.length}`, expires_in: 60 });
    }

    if (address.startsWith("https://openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      providerPrompts.push(body.messages[0].content);
      return aiStream(["We accept returns ", "within thirty days."]);
    }

    return realFetch(url, init);
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } });
});

describe("IT-31 voice calls from the website widget (M6 FE-6..8, FR-16.6)", () => {
  it("IT-31.01 the call button is offered only when switched on and the server has a Deepgram key", async () => {
    const config = async () =>
      ((await (await configRoute.GET(new Request(`http://localhost/api/widget/${widgetId}`, { headers: widgetHeaders() }), { params: Promise.resolve({ widgetId }) })).json()) as {
        chatbot: { voiceEnabled: boolean };
      }).chatbot.voiceEnabled;

    expect(await config()).toBe(true);
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    expect(await config()).toBe(false);
    expect((await voice({ action: "start", customerEmail: "x@example.com" })).status).toBe(403);
    vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key-for-tests");
    await prisma.chatbot.update({ where: { widgetId }, data: { voiceEnabled: false } });
    expect(await config()).toBe(false);
    expect((await voice({ action: "start", customerEmail: "x@example.com" })).status).toBe(403);
    await prisma.chatbot.update({ where: { widgetId }, data: { voiceEnabled: true } });
  });

  it("IT-31.02 a call is its own voice conversation under the same customer as the chat", async () => {
    // The visitor chatted first (website conversation).
    const chat = await readEvents(await say("Hi, I have a question", null, false));
    const chatToken = chat[0].sessionToken as string;
    const chatSession = chat[0].session as { id: string };

    const response = await voice({ action: "start", chatSessionToken: chatToken, customerName: "Caller" });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { sessionToken: string; deepgram: { accessToken: string; listenUrl: string; speakUrl: string; sampleRate: number } };
    expect(data.deepgram).toMatchObject({ accessToken: expect.stringMatching(/^temporary-jwt/), sampleRate: 24_000 });
    expect(data.deepgram.listenUrl).toContain("wss://api.deepgram.com/v1/listen?model=nova-3");
    expect(data.deepgram.speakUrl).toContain("wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en");
    expect(JSON.stringify(data)).not.toContain("fake-deepgram-key-for-tests");
    expect((grants.at(-1)?.headers as Record<string, string>).Authorization).toBe("Token fake-deepgram-key-for-tests");

    const [callSession, chatRow] = await Promise.all([
      prisma.chatSession.findFirstOrThrow({ where: { workspaceId, channel: "VOICE", previousSessionId: chatSession.id } }),
      prisma.chatSession.findUniqueOrThrow({ where: { id: chatSession.id } }),
    ]);
    expect(callSession.contactId).toBe(chatRow.contactId);
    expect(callSession.contactId).not.toBeNull();
    expect(await prisma.sessionEvent.count({ where: { sessionId: callSession.id, type: "VOICE_CALL_STARTED" } })).toBe(1);
  });

  it("IT-31.03 what the caller says is answered by the streamed AI, told to speak briefly, and recorded as VOICE", async () => {
    const started = (await (await voice({ action: "start", customerEmail: `caller-${suffix}@example.com` })).json()) as { sessionToken: string };
    const events = await readEvents(await say("What is your return policy?", started.sessionToken));

    expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toBe("We accept returns within thirty days.");
    const done = events.at(-1)!;
    const reply = (done.messages as Array<{ id: string; sender: string }>).find((message) => message.sender === "AI")!;
    expect(providerPrompts.at(-1)).toContain("You are speaking on a voice call");
    const interaction = await prisma.aiInteraction.findUniqueOrThrow({ where: { messageId: reply.id } });
    expect(interaction.channel).toBe("VOICE");
    expect(interaction.firstTokenMs).toEqual(expect.any(Number));
  });

  it("IT-31.04 the time to the first audio is stored once, only for a reply in the caller's own call", async () => {
    const own = (await (await voice({ action: "start", customerEmail: `caller-${suffix}@example.com` })).json()) as { sessionToken: string };
    const done = (await readEvents(await say("Do you ship abroad?", own.sessionToken))).at(-1)!;
    const replyId = (done.messages as Array<{ id: string; sender: string }>).find((message) => message.sender === "AI")!.id;
    visitor += 1;
    const other = (await (await voice({ action: "start", customerEmail: `other-${suffix}@example.com` })).json()) as { sessionToken: string };

    expect(await (await voice({ action: "metrics", messageId: replyId, firstAudioMs: 640 }, other.sessionToken)).json()).toEqual({ recorded: false });
    expect((await voice({ action: "metrics", messageId: replyId, firstAudioMs: -5 }, own.sessionToken)).status).toBe(400);
    expect(await (await voice({ action: "metrics", messageId: replyId, firstAudioMs: 640 }, own.sessionToken)).json()).toEqual({ recorded: true });
    expect(await (await voice({ action: "metrics", messageId: replyId, firstAudioMs: 999 }, own.sessionToken)).json()).toEqual({ recorded: false });
    expect((await prisma.aiInteraction.findUniqueOrThrow({ where: { messageId: replyId } })).firstAudioMs).toBe(640);

    const range = parseAnalyticsRange(new URLSearchParams("range=24h"), "UTC");
    expect((await loadAnalyticsDashboard(workspaceId, range)).kpis).toMatchObject({ medianFirstAudioMs: 640, voiceReplies: 1 });
  });

  it("IT-31.05 an open call can renew its token; hanging up closes it and its token stops working", async () => {
    const call = (await (await voice({ action: "start", customerEmail: `caller-${suffix}@example.com` })).json()) as { sessionToken: string };
    const renewed = (await (await voice({ action: "token" }, call.sessionToken)).json()) as { deepgram: { accessToken: string } };
    expect(renewed.deepgram.accessToken).toMatch(/^temporary-jwt/);
    expect((await voice({ action: "token" }, "not-a-real-session-token-000000")).status).toBe(404);

    expect(await (await voice({ action: "end" }, call.sessionToken)).json()).toEqual({ ended: true });
    const session = await prisma.chatSession.findFirstOrThrow({ where: { workspaceId, channel: "VOICE" }, orderBy: { startedAt: "desc" } });
    expect(session).toMatchObject({ status: "CLOSED", closedReason: "CLOSED_BY_CUSTOMER" });
    expect((await voice({ action: "token" }, call.sessionToken)).status).toBe(404);
  });

  it("IT-31.06 starting calls is rate limited per visitor", async () => {
    const before = visitor;
    visitor = 250; // a fresh address
    let lastStatus = 0;

    for (let attempt = 0; attempt < 11; attempt += 1) {
      lastStatus = (await voice({ action: "start", customerEmail: `burst-${suffix}@example.com` })).status;
    }

    expect(lastStatus).toBe(429);
    visitor = before;
  });
});
