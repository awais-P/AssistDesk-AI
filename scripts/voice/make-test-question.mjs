// Records a spoken test question with Deepgram's text-to-speech, for the live voice test
// (tests/ui/voice-live.spec.ts): Chromium plays the file as if it were the microphone.
//   node scripts/voice/make-test-question.mjs "What is your return policy?"   (writes tests/ui/.auth/voice-question.wav)
// Needs DEEPGRAM_API_KEY in the environment. 1.5 s of silence before and 3 s after, so the
// call is connected before the question starts and the end of speech is detected.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [text = "What is your return policy?", output = "tests/ui/.auth/voice-question.wav"] = process.argv.slice(2);
const apiKey = process.env.DEEPGRAM_API_KEY;
const SAMPLE_RATE = 48_000;

if (!apiKey) {
  console.error("Set DEEPGRAM_API_KEY.");
  process.exit(1);
}

const response = await fetch(
  `https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=${SAMPLE_RATE}&container=none`,
  {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  },
);

if (!response.ok) {
  console.error(`Deepgram refused (${response.status}): ${await response.text()}`);
  process.exit(1);
}

const speech = Buffer.from(await response.arrayBuffer());
const silence = (seconds) => Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);
const pcm = Buffer.concat([silence(1.5), speech, silence(3)]);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, pcm]));
console.log(`${output}: "${text}", ${(speech.length / 2 / SAMPLE_RATE).toFixed(1)} s of speech`);
