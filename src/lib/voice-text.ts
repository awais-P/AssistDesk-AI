/**
 * Voice calls (Module 6 FE-6..8): turning a streamed text reply into speech.
 * Pure functions, used in the browser and covered by unit tests.
 */

/** Text for the speech engine: Markdown, links, emojis and symbols are not read aloud. */
export function speakableText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link in the chat")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|\*|_|~~/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ");
}

/** Shortest phrase sent on its own: very short pieces make the voice sound choppy. */
const MIN_PHRASE = 24;
/** Longest wait for a sentence end before sending anyway (long run-on sentences). */
const MAX_PHRASE = 180;

/**
 * Collects streamed text and hands out speakable phrases as soon as a sentence or clause
 * is complete, so speech starts before the model has finished (FE-8). Phrases end at
 * ". ! ?" (or ", ; :" once long enough); `finish()` returns whatever is left.
 */
export function createPhraseChunker() {
  let pending = "";

  const take = (end: number) => {
    const phrase = pending.slice(0, end);
    pending = pending.slice(end);
    return speakableText(phrase).trim();
  };

  return {
    push(text: string): string[] {
      pending += text;
      const phrases: string[] = [];

      while (pending.length > 0) {
        // A sentence end followed by a space (the next sentence has started).
        const sentence = /[.!?…](?=\s)/.exec(pending.slice(MIN_PHRASE - 1));
        let end = sentence ? sentence.index + MIN_PHRASE : -1;

        if (end === -1 && pending.length > MAX_PHRASE) {
          // No sentence end yet: cut after the last clause mark, or the last space.
          const window = pending.slice(0, MAX_PHRASE);
          const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
          end = clause > MIN_PHRASE ? clause + 1 : window.lastIndexOf(" ") > MIN_PHRASE ? window.lastIndexOf(" ") : MAX_PHRASE;
        }

        if (end === -1) {
          break;
        }

        const phrase = take(end);

        if (phrase) {
          phrases.push(phrase);
        }
      }

      return phrases;
    },
    /** The rest of the reply, once the model has finished. */
    finish(): string | null {
      const phrase = take(pending.length);
      return phrase || null;
    },
    /** Forget everything (the caller interrupted). */
    reset() {
      pending = "";
    },
  };
}

/** Raw 16-bit little-endian PCM (Deepgram's linear16) to the -1..1 floats Web Audio plays. */
export function pcm16ToFloat32(buffer: ArrayBuffer) {
  const samples = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2));
  const output = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    output[index] = samples[index] / 0x8000;
  }

  return output;
}
