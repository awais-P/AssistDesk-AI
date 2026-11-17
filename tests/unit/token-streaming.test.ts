import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentGraph } from "@/src/lib/agent-engine/graph";
import type { ToolCallingModel } from "@/src/lib/agent-engine/model-chain";
import { clearQueryEmbeddingCacheForTests, embedQuery } from "@/src/lib/embeddings";
import { generateAgentReply } from "@/src/lib/llm-runtime";
import {
  guardedTokenSink,
  measuredStream,
  readServerSentEvents,
  streamAnthropic,
  streamGoogle,
  streamOpenAiCompatible,
} from "@/src/lib/llm-stream";
import { replyStreamResponse } from "@/src/lib/reply-stream-response";
import { closeOpenMarkdown } from "@/src/lib/streaming-markdown";
import {
  COOLDOWN_MS,
  isModelCooling,
  markModelCooling,
  recordModelFailure,
  resetModelHealthForTests,
  withoutGoneModels,
} from "@/src/lib/model-health";

const encoder = new TextEncoder();

/** A streamed HTTP body; with `failAfter` the connection breaks after that many pieces. */
function streamOf(pieces: string[], failAfter?: number) {
  let index = 0;

  // One piece per read, like a network connection (an error then really comes mid-reply).
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === failAfter) {
        controller.error(new Error("connection reset"));
      } else if (index >= pieces.length) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(pieces[index]));
      }

      index += 1;
    },
  });
}

const sse = (pieces: string[], failAfter?: number) =>
  new Response(streamOf(pieces, failAfter), { status: 200, headers: { "Content-Type": "text/event-stream" } });

const openAiDelta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function collect() {
  const events: string[] = [];
  return {
    events,
    stream: { onToken: (text: string) => events.push(text), onReset: () => events.push("<reset>") },
    /** The text the customer ends up seeing: everything after the last reset. */
    visible: () => events.slice(events.lastIndexOf("<reset>") + 1).join(""),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("UT-66 token streaming of AI replies (M5 / M6 FE-5)", () => {
  it("UT-66.01 server-sent events are read across network chunks, skipping comments", async () => {
    const body = streamOf(['data: {"a":1}\n', "\n: OPENROUTER PROCESSING\n\ndata: hel", "lo\r\n\r\n", "data: [DONE]\n\n"]);
    const events: string[] = [];

    for await (const data of readServerSentEvents(body)) {
      events.push(data);
    }

    expect(events).toEqual(['{"a":1}', "hello", "[DONE]"]);
  });

  it("UT-66.02 OpenAI-compatible providers (Groq, OpenAI, OpenRouter) stream piece by piece", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sse([
        openAiDelta("Hel"),
        openAiDelta("lo there"),
        `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 42 } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    const pieces: string[] = [];
    const result = await streamOpenAiCompatible({
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      apiKey: "fake-groq-key-for-tests",
      model: "llama-3.3-70b-versatile",
      system: "Be brief.",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.3,
      maxTokens: 100,
      firstTokenMs: 5_000,
      onText: (text) => pieces.push(text),
    });

    expect(pieces).toEqual(["Hel", "lo there"]);
    expect(result).toEqual({ reply: "Hello there", tokens: 42 });
    const body = JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("UT-66.03 Anthropic and Google stream in their own formats", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sse([
          `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10 } } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Ret" } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "urns: 30 days." } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 6 } })}\n\n`,
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ]),
      )
      .mockResolvedValueOnce(
        sse([
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Ships in " }] } }] })}\n\n`,
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "1 day." }] } }], usageMetadata: { totalTokenCount: 20 } })}\n\n`,
        ]),
      );
    const request = { apiKey: "fake-key-for-tests", model: "m", system: "s", messages: [{ role: "user" as const, content: "q" }], temperature: 0.2, maxTokens: 50, firstTokenMs: 5_000 };
    const anthropic: string[] = [];
    const google: string[] = [];

    expect(await streamAnthropic({ ...request, onText: (text) => anthropic.push(text) })).toEqual({ reply: "Returns: 30 days.", tokens: 16 });
    expect(await streamGoogle({ ...request, onText: (text) => google.push(text) })).toEqual({ reply: "Ships in 1 day.", tokens: 20 });
    expect(anthropic).toEqual(["Ret", "urns: 30 days."]);
    expect(google).toEqual(["Ships in ", "1 day."]);
  });

  it("UT-66.04 a provider that sends nothing in time is abandoned", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    await expect(
      streamOpenAiCompatible({
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: "fake-key-for-tests",
        model: "m",
        system: "s",
        messages: [{ role: "user", content: "q" }],
        temperature: 0.3,
        maxTokens: 50,
        firstTokenMs: 40,
        onText: () => undefined,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("UT-66.05 moderation labels never reach the customer; real answers flow after a few characters", () => {
    const shown: string[] = [];
    const answer = guardedTokenSink((text) => shown.push(text));
    answer.push("Hi");
    expect(shown).toEqual([]); // held back until it is clearly an answer
    answer.push(" there, how can I help you today?");
    answer.push(" Ask away.");
    expect(shown).toEqual(["Hi there, how can I help you today?", " Ask away."]);

    const label = guardedTokenSink((text) => shown.push(`LABEL:${text}`));
    label.push("User Safety: unsafe\nResponse Safety: safe");
    label.finish("User Safety: unsafe\nResponse Safety: safe");
    const short = guardedTokenSink((text) => shown.push(`SHORT:${text}`));
    short.push("unsafe\nS1");
    short.finish("unsafe\nS1");
    expect(shown.some((text) => text.startsWith("LABEL:") || text.startsWith("SHORT:"))).toBe(false);
    expect(label.emitted || short.emitted).toBe(false);

    const brief = guardedTokenSink((text) => shown.push(`BRIEF:${text}`));
    brief.push("Hello!");
    brief.finish("Hello!");
    expect(shown.at(-1)).toBe("BRIEF:Hello!");
  });

  it("UT-66.06 when a model breaks mid-reply, its text is withdrawn and the next model streams the answer", async () => {
    vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "fake-openrouter-key-for-tests");
    vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "");
    vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const models: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      models.push(JSON.parse(String(init?.body)).model);
      return models.length === 1
        ? sse([openAiDelta("Our returns window is "), openAiDelta("thirty"), openAiDelta(" days")], 2)
        : sse([openAiDelta("Returns are accepted "), openAiDelta("within 30 days."), "data: [DONE]\n\n"]);
    });
    const sink = collect();

    const result = await generateAgentReply({
      agent: { provider: "Default", model: "openrouter/google/gemma-4-31b-it:free", apiKey: null, systemPrompt: "Store bot", confidenceThreshold: 0.5 },
      question: "What is your return policy?",
      sources: [],
      channel: "WEB_WIDGET",
      stream: sink.stream,
    });

    expect(models).toHaveLength(2);
    expect(sink.events).toContain("<reset>");
    expect(sink.visible()).toBe("Returns are accepted within 30 days.");
    expect(result).toMatchObject({ reply: "Returns are accepted within 30 days.", usedFallback: false });
  });

  it("UT-66.07 without a stream the reply is fetched in one piece, as before", async () => {
    vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "fake-openrouter-key-for-tests");
    vi.stubEnv("ASSISTDESK_DEFAULT_GROQ_API_KEY", "");
    vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ choices: [{ message: { content: "Thirty days." } }], usage: { total_tokens: 9 } }),
    );

    const result = await generateAgentReply({
      agent: { provider: "Default", model: "openrouter/google/gemma-4-31b-it:free", apiKey: null, systemPrompt: null, confidenceThreshold: 0.5 },
      question: "Return window?",
      sources: [],
    });

    expect(result.reply).toBe("Thirty days.");
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).stream).toBeUndefined();
  });

  it("UT-66.08 the tool-using engine streams the answer and withdraws text written before a tool call", async () => {
    const sink = collect();
    let step = 0;
    const model: ToolCallingModel = {
      id: "scripted",
      async invoke(_messages, { onToken }) {
        step += 1;

        if (step === 1) {
          // A model that "thinks aloud" and then fails is dropped.
          onToken?.("Let me look that up");
          throw new Error("503 overloaded");
        }

        onToken?.("Your order ");
        onToken?.("ships today.");
        return new AIMessage({ content: "Your order ships today." });
      },
    };

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runAgentGraph({
      models: [model, model],
      messages: [new HumanMessage("When does my order ship?")],
      tools: [],
      ctx: {} as never,
      maxSteps: 2,
      stream: sink.stream,
    });

    expect(result.answer).toBe("Your order ships today.");
    expect(sink.events).toEqual(["Let me look that up", "<reset>", "Your order ", "ships today."]);
    expect(sink.visible()).toBe(result.answer);
  });

  it("UT-66.09 the time to the first word is measured from the start of the reply", () => {
    const sink = collect();
    const startedAt = Date.now() - 250;
    const measured = measuredStream(sink.stream, startedAt);

    expect(measured.firstTokenMs).toBeNull();
    measured.stream?.onToken(" ");
    expect(measured.firstTokenMs).toBeNull(); // whitespace is not a word yet
    measured.stream?.onToken("Hi");
    expect(measured.firstTokenMs).toBeGreaterThanOrEqual(250);
    measured.stream?.onReset();
    expect(measured.firstTokenMs).toBeNull();
    expect(measuredStream(undefined).stream).toBeUndefined();
  });

  it("UT-66.10 the HTTP stream sends one JSON line per event, without compression, and reports failures", async () => {
    const ok = replyStreamResponse(async (send) => {
      send({ type: "start" });
      send({ type: "delta", text: "Hi" });
      send({ type: "done", reply: "Hi" });
    });
    expect(ok.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(ok.headers.get("Cache-Control")).toContain("no-transform");
    expect((await ok.text()).trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["start", "delta", "done"]);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failed = replyStreamResponse(async (send) => {
      send({ type: "start" });
      throw new Error("database down");
    }, "Please try again.");
    const lines = (await failed.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: "error", error: "Please try again." });
  });

  it("UT-66.11 a rate-limited or slow model is skipped for two minutes, so replies go straight to one that works", () => {
    resetModelHealthForTests();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const chain = ["openrouter/google/gemma-4-31b-it:free", "openrouter/openrouter/free"];

    expect(recordModelFailure(chain[0], "429 Provider returned error")).toBe(true);
    expect(withoutGoneModels(chain, (id) => id)).toEqual(["openrouter/openrouter/free"]);
    expect(recordModelFailure("x/slow", "The AI provider took too long to respond.")).toBe(true);
    expect(recordModelFailure("x/bad-request", "400 Invalid parameter")).toBe(false);

    const now = Date.now();
    markModelCooling("only/model", "429", now);
    expect(withoutGoneModels(["only/model"], (id) => id)).toEqual(["only/model"]); // never empty
    expect(isModelCooling("only/model", now + COOLDOWN_MS - 1)).toBe(true);
    expect(isModelCooling("only/model", now + COOLDOWN_MS + 1)).toBe(false);
    resetModelHealthForTests();
  });

  it("UT-66.12 a repeated question reuses its embedding; a failed one is not remembered", async () => {
    vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", "fake-openrouter-key-for-tests");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    clearQueryEmbeddingCacheForTests();
    const model = "openrouter:openai/text-embedding-3-small";
    let failNext = false;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      failNext
        ? new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 })
        : Response.json({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
    );

    // Two visitors ask at the same moment: one provider call.
    const [first, second] = await Promise.all([embedQuery("What is your return policy?", model), embedQuery("What is your return policy?", model)]);
    expect(first).toEqual([0.1, 0.2, 0.3]);
    expect(second).toBe(first);
    expect(await embedQuery("What is your return policy?", model)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);

    failNext = true;
    await expect(embedQuery("Do you ship abroad?", model)).rejects.toThrow("overloaded");
    failNext = false;
    expect(await embedQuery("Do you ship abroad?", model)).toEqual([0.1, 0.2, 0.3]);
    clearQueryEmbeddingCacheForTests();
  });

  it("UT-66.13 half-written Markdown is closed while streaming, so no stray asterisks flicker", () => {
    expect(closeOpenMarkdown("Delivery is **free over")).toBe("Delivery is **free over**");
    expect(closeOpenMarkdown("Delivery is **free** over PKR 10,000")).toBe("Delivery is **free** over PKR 10,000");
    expect(closeOpenMarkdown("It is *really")).toBe("It is *really*");
    expect(closeOpenMarkdown("Use code `SAVE")).toBe("Use code `SAVE`");
    expect(closeOpenMarkdown("Code `a**b` and **bold")).toBe("Code `a**b` and **bold**");
    expect(closeOpenMarkdown("Next comes *")).toBe("Next comes "); // may become "**"
    expect(closeOpenMarkdown("* first item\n* second")).toBe("* first item\n* second");
    expect(closeOpenMarkdown("See [our policy](https://exa")).toBe("See our policy");
    expect(closeOpenMarkdown("See [our pol")).toBe("See our pol");
    expect(closeOpenMarkdown("See [our policy](https://example.com).")).toBe("See [our policy](https://example.com).");
  });
});
