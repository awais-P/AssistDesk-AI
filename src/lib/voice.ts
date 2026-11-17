/**
 * Voice channel (Module 6 FE-6..8, FR-16.6, M5 FE-2, M9 FE-2).
 *
 *   browser mic ──audio──▶ Deepgram speech-to-text (endpointing = end of speech, FE-7)
 *        │                       │ final transcript
 *        │                       ▼
 *        │        POST /api/widget/{id}/messages  (token streaming, the same AI pipeline)
 *        │                       │ text pieces
 *        ▼                       ▼
 *   speaker ◀──audio── Deepgram streaming text-to-speech (starts before the reply ends, FE-8)
 *
 * The browser talks to Deepgram directly with a short-lived token from this server
 * (the API key never leaves the server), so no audio passes through AssistDesk and
 * nothing adds a hop. Each call is its own VOICE conversation under the same customer.
 */

const DEEPGRAM_API = "https://api.deepgram.com/v1";
const DEEPGRAM_WS = "wss://api.deepgram.com/v1";

/** How long the browser's token may be used to open a connection (open ones stay open). */
export const VOICE_TOKEN_TTL_SECONDS = 60;
/** Text-to-speech audio format: raw 16-bit PCM, played directly with Web Audio. */
export const VOICE_SAMPLE_RATE = 24_000;

export function deepgramApiKey() {
  return process.env.DEEPGRAM_API_KEY?.trim() || null;
}

/** Voice calls need a Deepgram key on the server (speech-to-text and text-to-speech). */
export function isVoiceConfigured() {
  return Boolean(deepgramApiKey());
}

export function voiceModels() {
  return {
    speechToText: process.env.ASSISTDESK_VOICE_STT_MODEL?.trim() || "nova-3",
    textToSpeech: process.env.ASSISTDESK_VOICE_TTS_MODEL?.trim() || "aura-2-thalia-en",
  };
}

/** The Deepgram addresses the browser connects to (models and settings chosen here). */
export function voiceConnectionUrls() {
  const models = voiceModels();
  const listen = new URLSearchParams({
    model: models.speechToText,
    smart_format: "true",
    interim_results: "true",
    // End of speech (VAD, FE-7): a 300 ms pause ends a sentence; 1 s of silence ends the turn.
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
  });
  const speak = new URLSearchParams({
    model: models.textToSpeech,
    encoding: "linear16",
    sample_rate: String(VOICE_SAMPLE_RATE),
  });

  return {
    listenUrl: `${DEEPGRAM_WS}/listen?${listen.toString()}`,
    speakUrl: `${DEEPGRAM_WS}/speak?${speak.toString()}`,
    sampleRate: VOICE_SAMPLE_RATE,
  };
}

/**
 * A short-lived Deepgram token for the browser (POST /v1/auth/grant). The key needs
 * "Member" permission. Throws with Deepgram's reason when refused.
 */
export async function mintVoiceToken() {
  const apiKey = deepgramApiKey();

  if (!apiKey) {
    throw new Error("Voice is not configured (DEEPGRAM_API_KEY).");
  }

  const response = await fetch(`${DEEPGRAM_API}/auth/grant`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: VOICE_TOKEN_TTL_SECONDS }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    err_msg?: string;
    message?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new Error(`Deepgram refused the voice token (${response.status}): ${data.err_msg ?? data.message ?? "no token"}`);
  }

  return { accessToken: data.access_token, expiresIn: data.expires_in ?? VOICE_TOKEN_TTL_SECONDS };
}
