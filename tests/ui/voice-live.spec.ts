import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { EMBEDDING_PAGE, WIDGET_ID, newVisitorContext, waitForHydration } from "./helpers";

/**
 * UI-VOI-02: a real voice call, end to end. The microphone is a recorded question played
 * through Web Audio (headless Chrome's fake microphone only gives silence); everything
 * after it is real: Deepgram transcribes and detects the end of speech, the AI answers
 * (streamed), Deepgram speaks the answer. Measures the time from the end of speech to the
 * first audio (M6 FE-6, target < 500 ms).
 *
 * Opt-in (real accounts, real cost): needs DEEPGRAM_API_KEY on the server, the demo
 * chatbot's "Voice calls" switched on, and a recorded question (kept out of test-results,
 * which Playwright empties):
 *   node scripts/voice/make-test-question.mjs "What is your return policy?"
 *   VOICE_LIVE_WAV=tests/ui/.auth/voice-question.wav npx playwright test tests/ui/voice-live.spec.ts
 */
const recording = process.env.VOICE_LIVE_WAV;

test.skip(!recording, "Set VOICE_LIVE_WAV to run the live voice test.");
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

test("UI-VOI-02 a real call: spoken question, spoken answer, time to the first audio", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await newVisitorContext(browser, EMBEDDING_PAGE);
  await context.route("**/__voice-question.wav", (route) =>
    route.fulfill({ body: readFileSync(recording as string), contentType: "audio/wav" }),
  );
  const page = await context.newPage();

  // The "microphone": the recorded question, starting a moment after the call opens.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      await audio.resume();
      const buffer = await audio.decodeAudioData(await (await fetch("/__voice-question.wav")).arrayBuffer());
      const microphone = audio.createMediaStreamDestination();
      const question = audio.createBufferSource();
      question.buffer = buffer;
      question.connect(microphone);
      question.start(audio.currentTime + 0.3);
      return microphone.stream;
    };
  });

  const firstAudio: number[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/voice") && request.method() === "POST") {
      const body = request.postDataJSON() as { action?: string; firstAudioMs?: number };
      if (body.action === "metrics" && typeof body.firstAudioMs === "number") firstAudio.push(body.firstAudioMs);
    }
  });

  await page.goto(`/widget/${WIDGET_ID}`, { referer: EMBEDDING_PAGE });
  await waitForHydration(page);
  await page.getByRole("button", { name: "Call the assistant" }).click();

  const panel = page.getByRole("region", { name: /Voice call with/ });
  await expect(panel.getByText(/return policy/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText(/answered in \d/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => firstAudio.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const transcript = await panel.getByRole("list", { name: "Call transcript" }).innerText();
  test.info().annotations.push({ type: "first audio", description: `${firstAudio[0]} ms` }, { type: "transcript", description: transcript.replace(/\s+/g, " ") });
  console.log(`[UI-VOI-02] first audio after ${firstAudio[0]} ms\n${transcript}`);

  await panel.getByRole("button", { name: "End the call" }).click();
  await expect(panel.getByText("Call ended")).toBeVisible();
  await context.close();
});
