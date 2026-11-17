import { expect, test } from "@playwright/test";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, waitForHydration } from "./helpers";

/**
 * Voice call in the website widget (M6 FE-6..8, FR-16.6), in a real browser.
 * Deepgram's two WebSockets are simulated here and the microphone is a generated tone;
 * everything else is real: the widget code, the streamed AI reply (real model), the
 * audio playback, the latency report and hanging up.
 */

const FAKE_VOICE_TOKEN = "fake-voice-session-token-for-ui-tests-0001";

/** 0.1 s of a quiet tone as raw 16-bit PCM at 24 kHz (what Deepgram's speech sends). */
function pcmTone() {
  const samples = new Int16Array(2400);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.round(Math.sin(index / 8) * 3000);
  return Buffer.from(samples.buffer);
}

test.describe("Voice calls (M6 FE-6..8, FR-16.6)", () => {
  test("UI-VOI-01 a caller speaks, hears the streamed answer, sees the response time and hangs up", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await newVisitorContext(browser, EMBEDDING_PAGE);
    const page = await context.newPage();
    const spoken: string[] = [];
    const voiceCalls: Array<Record<string, unknown>> = [];
    let listenSubprotocol = "";

    // A microphone: a generated tone (no device in a headless browser).
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const output = audio.createMediaStreamDestination();
        tone.connect(output);
        tone.start();
        return output.stream;
      };
    });

    // The server here has no Deepgram key: the call button is switched on and the voice
    // endpoint answered for the test. The caller's words still go to the real AI.
    await page.route(`**/api/widget/${WIDGET_ID}`, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, chatbot: { ...data.chatbot, voiceEnabled: true } } });
    });
    await page.route(`**/api/widget/${WIDGET_ID}/voice`, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      voiceCalls.push(body);
      const deepgram = {
        accessToken: "fake-deepgram-token",
        listenUrl: "wss://api.deepgram.com/v1/listen?model=nova-3",
        speakUrl: "wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000",
        sampleRate: 24000,
        expiresIn: 60,
      };
      await route.fulfill({
        json: body.action === "start" ? { sessionToken: FAKE_VOICE_TOKEN, deepgram } : body.action === "end" ? { ended: true } : { recorded: true, deepgram },
      });
    });

    // Deepgram speech-to-text: once audio arrives, the caller "says" a question.
    await page.routeWebSocket(/wss:\/\/api\.deepgram\.com\/v1\/listen/, (ws) => {
      let answered = false;
      listenSubprotocol = ws.url();
      ws.onMessage((message) => {
        if (!answered && typeof message !== "string") {
          answered = true;
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "Results", is_final: false, speech_final: false, channel: { alternatives: [{ transcript: "What is your" }] } }));
            ws.send(JSON.stringify({ type: "Results", is_final: true, speech_final: true, channel: { alternatives: [{ transcript: "What is your return policy?" }] } }));
          }, 300);
        }
      });
    });
    // Deepgram speech: every phrase comes back as audio.
    await page.routeWebSocket(/wss:\/\/api\.deepgram\.com\/v1\/speak/, (ws) => {
      ws.onMessage((message) => {
        const data = JSON.parse(String(message)) as { type: string; text?: string };
        if (data.type === "Speak" && data.text) {
          spoken.push(data.text);
          ws.send(pcmTone());
        } else if (data.type === "Flush") {
          ws.send(JSON.stringify({ type: "Flushed", sequence_id: 0 }));
        } else if (data.type === "Clear") {
          ws.send(JSON.stringify({ type: "Cleared", sequence_id: 0 }));
        }
      });
    });

    await page.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
    await waitForHydration(page);
    await page.getByRole("button", { name: "Call the assistant" }).click();

    const panel = page.getByRole("region", { name: /Voice call with/ });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("You:")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("What is your return policy?")).toBeVisible();
    // The real AI answers; its words are spoken phrase by phrase.
    await expect(panel.getByText(/answered in \d/)).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => spoken.length, { timeout: 60_000 }).toBeGreaterThan(0);
    expect(spoken.join(" ")).not.toMatch(/\*\*|\]\(|#/); // no Markdown read aloud
    await expect.poll(() => voiceCalls.some((call) => call.action === "metrics" && typeof call.firstAudioMs === "number"), { timeout: 60_000 }).toBe(true);

    await panel.getByRole("button", { name: "End the call" }).click();
    await expect(panel.getByText("Call ended")).toBeVisible();
    expect(voiceCalls.map((call) => call.action)).toEqual(expect.arrayContaining(["start", "metrics", "end"]));
    expect(listenSubprotocol).toContain("model=nova-3");
    await context.close();
  });
});
