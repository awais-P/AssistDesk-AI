/** One event of a streamed reply (see src/lib/reply-stream-response.ts). */
export type ReplyStreamEvent = { type: string } & Record<string, unknown>;

/** The client side of a streamed reply: the request asked for it with this Accept header. */
export const REPLY_STREAM_ACCEPT = "application/x-ndjson, application/json";

export function isReplyStream(response: Response) {
  return response.ok && Boolean(response.body) && (response.headers.get("Content-Type") ?? "").includes("application/x-ndjson");
}

/**
 * Reads a streamed reply (one JSON object per line) and hands each event over as soon
 * as its line is complete. A malformed line is skipped: the final "done" event carries
 * the whole reply anyway.
 */
export async function readReplyStream(body: ReadableStream<Uint8Array>, onEvent: (event: ReplyStreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    if (!line.trim()) {
      return;
    }

    try {
      onEvent(JSON.parse(line) as ReplyStreamEvent);
    } catch {
      // Skipped.
    }
  };

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }

  handleLine(buffer + decoder.decode());
}
