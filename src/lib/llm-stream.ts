/**
 * Token streaming for AI replies (Module 5 / Module 6 FE-5): the reply is sent to the
 * customer piece by piece while the model writes it, instead of after it has finished.
 *
 * Every provider streams with Server-Sent Events; this file reads those streams and
 * hands each piece of text to a `ReplyStream`. Nothing is buffered beyond a few
 * characters, so the first word reaches the customer as soon as the model produces it.
 */

/** Receives the reply while it is being written. */
export type ReplyStream = {
  /** The next piece of the reply, in order. */
  onToken: (text: string) => void;
  /**
   * Everything sent so far is void: the model failed half-way (the next model in the
   * chain starts again) or it decided to use a tool instead of answering.
   */
  onReset: () => void;
};

/** Time the provider gets to send its first piece; after that the stream may run longer. */
export const FIRST_TOKEN_TIMEOUT_MS = 12_000;
/** A streamed reply may take this long in total (long answers on slow free models). */
export const STREAM_TOTAL_TIMEOUT_MS = 60_000;

/**
 * Reads a `text/event-stream` body and yields the `data:` payload of every event.
 * Comment lines (": keep-alive", OpenRouter's ": OPENROUTER PROCESSING") are skipped.
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  const flushEvent = function* () {
    if (data.length > 0) {
      yield data.join("\n");
      data = [];
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");

      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (line === "") {
          yield* flushEvent();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(line.charAt(5) === " " ? 6 : 5));
        }
        // "event:", "id:", "retry:" and ":" comments are not needed here.
      }
    }

    buffer += decoder.decode();

    if (buffer.startsWith("data:")) {
      data.push(buffer.slice(buffer.charAt(5) === " " ? 6 : 5).replace(/\r$/, ""));
    }

    yield* flushEvent();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Aborts a streaming request when the first piece takes too long, or when the whole
 * reply takes too long. `firstToken()` switches from the first deadline to the total one.
 */
export function streamDeadline(firstTokenMs: number, totalMs = STREAM_TOTAL_TIMEOUT_MS) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeoutError = () => Object.assign(new Error("The AI provider took too long to respond."), { name: "TimeoutError" });
  let timer = setTimeout(() => controller.abort(timeoutError()), firstTokenMs);
  let receivedFirst = false;

  return {
    signal: controller.signal,
    firstToken() {
      if (receivedFirst) {
        return;
      }

      receivedFirst = true;
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(timeoutError()), Math.max(1_000, totalMs - (Date.now() - startedAt)));
    },
    done() {
      clearTimeout(timer);
    },
  };
}

/** Same rule as `isUnusableReply` in llm-runtime: moderation labels instead of an answer. */
const SAFETY_LABEL_PREFIX = /^\s*(user|response|prompt)\s+safety\s*:/i;
const SAFETY_LABEL_ONLY = /^\s*(safe|unsafe)(\s*\n\s*S\d+)?\s*$/i;
/** Enough characters to tell a real answer from a moderation label. */
const GUARD_CHARACTERS = 24;

/**
 * Free "auto" routers sometimes answer with a moderation model, whose output must never
 * reach the customer. The first few characters are held back until it is clear this is a
 * real answer (a few milliseconds at streaming speed), then everything flows through.
 */
export function guardedTokenSink(onToken: (text: string) => void) {
  let held = "";
  let open = false;
  let blocked = false;
  let emitted = false;

  const release = (text: string) => {
    if (text) {
      emitted = true;
      onToken(text);
    }
  };

  return {
    push(text: string) {
      if (blocked || !text) {
        return;
      }

      if (open) {
        release(text);
        return;
      }

      held += text;

      if (held.length >= GUARD_CHARACTERS) {
        if (SAFETY_LABEL_PREFIX.test(held)) {
          blocked = true;
          return;
        }

        open = true;
        release(held);
        held = "";
      }
    },
    /** Called when the model finished: releases a short answer that was still held back. */
    finish(fullText: string) {
      if (!open && !blocked && held && !SAFETY_LABEL_PREFIX.test(fullText) && !SAFETY_LABEL_ONLY.test(fullText)) {
        release(held);
      }

      held = "";
    },
    /** Whether any text reached the customer (and must be withdrawn if this model fails). */
    get emitted() {
      return emitted;
    },
  };
}

type OpenAiStreamChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { total_tokens?: number } | null;
  error?: { message?: string } | string;
};

async function streamErrorMessage(response: Response, fallback: string) {
  const text = await response.text().catch(() => "");

  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string };
    return typeof data.error === "string" ? data.error : data.error?.message || fallback;
  } catch {
    return text.slice(0, 200) || fallback;
  }
}

function chunkError(error: OpenAiStreamChunk["error"]) {
  return typeof error === "string" ? error : error?.message || "The AI provider reported an error.";
}

export type StreamedResult = { reply: string; tokens: number };

type StreamRequest = {
  apiKey: string;
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature: number;
  maxTokens: number;
  firstTokenMs: number;
  onText: (text: string) => void;
};

/** OpenAI-compatible chat completions (OpenAI, Groq, OpenRouter). */
export async function streamOpenAiCompatible({
  endpoint,
  extraHeaders,
  extraBody,
  ...request
}: StreamRequest & {
  endpoint: string;
  extraHeaders?: Record<string, string>;
  /** Provider-specific settings, e.g. Groq's reasoning_effort for reasoning models. */
  extraBody?: Record<string, unknown>;
}): Promise<StreamedResult> {
  const deadline = streamDeadline(request.firstTokenMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: request.model,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "system", content: request.system }, ...request.messages],
        ...extraBody,
      }),
      signal: deadline.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(await streamErrorMessage(response, `Provider request failed (${response.status}).`));
    }

    let reply = "";
    let tokens = 0;

    for await (const data of readServerSentEvents(response.body)) {
      if (data === "[DONE]") {
        break;
      }

      let chunk: OpenAiStreamChunk;

      try {
        chunk = JSON.parse(data) as OpenAiStreamChunk;
      } catch {
        continue;
      }

      if (chunk.error) {
        throw new Error(chunkError(chunk.error));
      }

      const text = chunk.choices?.[0]?.delta?.content;

      if (text) {
        deadline.firstToken();
        reply += text;
        request.onText(text);
      }

      if (chunk.usage?.total_tokens) {
        tokens = chunk.usage.total_tokens;
      }
    }

    return { reply: reply.trim(), tokens };
  } finally {
    deadline.done();
  }
}

type AnthropicStreamEvent = {
  type?: string;
  delta?: { type?: string; text?: string };
  message?: { usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

export async function streamAnthropic(request: StreamRequest): Promise<StreamedResult> {
  const deadline = streamDeadline(request.firstTokenMs);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: request.messages,
        stream: true,
      }),
      signal: deadline.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(await streamErrorMessage(response, `Anthropic request failed (${response.status}).`));
    }

    let reply = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const data of readServerSentEvents(response.body)) {
      let event: AnthropicStreamEvent;

      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      if (event.type === "error") {
        throw new Error(event.error?.message || "Anthropic reported an error.");
      }

      if (event.type === "message_start") {
        inputTokens = event.message?.usage?.input_tokens ?? 0;
      } else if (event.type === "message_delta") {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        deadline.firstToken();
        reply += event.delta.text;
        request.onText(event.delta.text);
      } else if (event.type === "message_stop") {
        break;
      }
    }

    return { reply: reply.trim(), tokens: inputTokens + outputTokens };
  } finally {
    deadline.done();
  }
}

type GoogleStreamChunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { totalTokenCount?: number };
  error?: { message?: string };
};

export async function streamGoogle(request: StreamRequest): Promise<StreamedResult> {
  const deadline = streamDeadline(request.firstTokenMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": request.apiKey,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.content }],
          })),
          generationConfig: { temperature: request.temperature, maxOutputTokens: request.maxTokens },
        }),
        signal: deadline.signal,
      },
    );

    if (!response.ok || !response.body) {
      throw new Error(await streamErrorMessage(response, `Google request failed (${response.status}).`));
    }

    let reply = "";
    let tokens = 0;

    for await (const data of readServerSentEvents(response.body)) {
      let chunk: GoogleStreamChunk;

      try {
        chunk = JSON.parse(data) as GoogleStreamChunk;
      } catch {
        continue;
      }

      if (chunk.error) {
        throw new Error(chunk.error.message || "Google reported an error.");
      }

      const text = chunk.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

      if (text) {
        deadline.firstToken();
        reply += text;
        request.onText(text);
      }

      tokens = chunk.usageMetadata?.totalTokenCount ?? tokens;
    }

    return { reply: reply.trim(), tokens };
  } finally {
    deadline.done();
  }
}

/**
 * Wraps a stream to measure the time to the first piece of text (the latency the
 * customer actually feels). `firstTokenMs` stays null when nothing was streamed.
 */
export function measuredStream(stream: ReplyStream | undefined, startedAt = Date.now()) {
  let firstTokenAt: number | null = null;

  const wrapped: ReplyStream | undefined = stream
    ? {
        onToken(text) {
          if (firstTokenAt === null && text.trim()) {
            firstTokenAt = Date.now();
          }

          stream.onToken(text);
        },
        onReset() {
          firstTokenAt = null;
          stream.onReset();
        },
      }
    : undefined;

  return {
    stream: wrapped,
    get firstTokenMs() {
      return firstTokenAt === null ? null : firstTokenAt - startedAt;
    },
  };
}
