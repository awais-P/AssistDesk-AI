import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrompt } from "@/src/lib/llm-runtime";
import { isVoiceConfigured, mintVoiceToken, voiceConnectionUrls } from "@/src/lib/voice";
import { createPhraseChunker, pcm16ToFloat32, speakableText } from "@/src/lib/voice-text";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("UT-67 voice channel (M6 FE-6..8, FR-16.6)", () => {
  it("UT-67.01 replies are cleaned for speech: no Markdown, links, lists or emojis are read aloud", () => {
    expect(speakableText("**Free delivery** over PKR 10,000 🎉")).toBe("Free delivery over PKR 10,000 ");
    expect(speakableText("See [our policy](https://shop.example.com/returns).")).toBe("See our policy.");
    expect(speakableText("Visit https://shop.example.com now")).toBe("Visit the link in the chat now");
    expect(speakableText("Options:\n- Standard\n- Express")).toBe("Options: Standard Express");
    expect(speakableText("## Hours\nUse `ORDER-1` today")).toBe("Hours Use ORDER-1 today");
  });

  it("UT-67.02 streamed text is spoken phrase by phrase, as soon as a sentence is complete", () => {
    const chunker = createPhraseChunker();

    expect(chunker.push("Orders ship within one ")).toEqual([]); // still mid-sentence
    expect(chunker.push("business day. Delivery takes ")).toEqual(["Orders ship within one business day."]);
    expect(chunker.push("3 to 5 days")).toEqual([]);
    expect(chunker.finish()).toBe("Delivery takes 3 to 5 days");
    expect(chunker.finish()).toBeNull();

    // Very short sentences wait for more, so the voice doesn't sound choppy.
    expect(chunker.push("Hi! Yes. ")).toEqual([]);
    chunker.reset();
    expect(chunker.finish()).toBeNull();

    // A long run-on sentence is cut at a clause instead of waiting for its end.
    const long = `${"We stock kettles, toasters and blenders in many colours, ".repeat(4)}and more`;
    const pieces = chunker.push(long);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((piece) => piece.length <= 180)).toBe(true);
  });

  it("UT-67.03 raw 16-bit speech audio becomes Web Audio samples", () => {
    const pcm = new Int16Array([0, 16384, -32768, 32767]);
    const samples = pcm16ToFloat32(pcm.buffer);

    expect(Array.from(samples)).toEqual([0, 0.5, -1, 32767 / 32768]);
    expect(pcm16ToFloat32(new Uint8Array([1, 2, 3]).buffer)).toHaveLength(1); // odd byte ignored
  });

  it("UT-67.04 the browser gets a short-lived token; the API key stays on the server", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    expect(isVoiceConfigured()).toBe(false);
    await expect(mintVoiceToken()).rejects.toThrow("DEEPGRAM_API_KEY");

    vi.stubEnv("DEEPGRAM_API_KEY", "fake-deepgram-key-for-tests");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: "temporary-jwt", expires_in: 60 }))
      .mockResolvedValueOnce(Response.json({ err_code: "FORBIDDEN", err_msg: "Insufficient permissions." }, { status: 403 }));

    expect(await mintVoiceToken()).toEqual({ accessToken: "temporary-jwt", expiresIn: 60 });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepgram.com/v1/auth/grant");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token fake-deepgram-key-for-tests");
    expect(JSON.parse(String(init.body))).toEqual({ ttl_seconds: 60 });
    await expect(mintVoiceToken()).rejects.toThrow("Insufficient permissions");
  });

  it("UT-67.05 speech-to-text ends a turn on a pause (VAD) and speech is raw PCM for instant playback", () => {
    const { listenUrl, speakUrl, sampleRate } = voiceConnectionUrls();
    const listen = new URL(listenUrl);
    const speak = new URL(speakUrl);

    expect(listen.origin + listen.pathname).toBe("wss://api.deepgram.com/v1/listen");
    expect(Object.fromEntries(listen.searchParams)).toMatchObject({
      model: "nova-3",
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    expect(speak.origin + speak.pathname).toBe("wss://api.deepgram.com/v1/speak");
    expect(Object.fromEntries(speak.searchParams)).toEqual({ model: "aura-2-thalia-en", encoding: "linear16", sample_rate: "24000" });
    expect(sampleRate).toBe(24_000);
  });

  it("UT-67.06 on a call the AI is told to answer in short spoken sentences", async () => {
    const { prompt } = await buildPrompt({
      agent: { provider: "Default", model: "groq/llama-3.3-70b-versatile", apiKey: null, systemPrompt: "Store bot", confidenceThreshold: 0.5 },
      question: "hello",
      sources: [],
      history: [],
      channel: "VOICE",
    });

    expect(prompt.system).toContain("You are speaking on a voice call");
    expect(prompt.system).toContain("No Markdown");
  });
});
