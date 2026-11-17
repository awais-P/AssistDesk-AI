import type { ReplyStream } from "./llm-stream";

/**
 * Streamed replies over HTTP: one JSON object per line (NDJSON). A client opts in with
 * `Accept: application/x-ndjson`; everyone else keeps the single JSON response.
 *
 *   {"type":"start", ...}   the request was accepted (the customer's message is saved)
 *   {"type":"delta","text"} the next piece of the AI reply
 *   {"type":"reset"}        discard the pieces so far (the next model starts again)
 *   {"type":"done", ...}    the final result, the same fields as the JSON response
 *   {"type":"error",...}    the request failed after streaming started
 */
export const REPLY_STREAM_CONTENT_TYPE = "application/x-ndjson";

export function wantsReplyStream(request: Request) {
  return (request.headers.get("accept") ?? "").includes(REPLY_STREAM_CONTENT_TYPE);
}

export type ReplyStreamSend = (event: { type: string } & Record<string, unknown>) => void;

/** A ReplyStream that forwards the reply to the client as `delta` / `reset` lines. */
export function forwardReply(send: ReplyStreamSend): ReplyStream {
  return {
    onToken: (text) => send({ type: "delta", text }),
    onReset: () => send({ type: "reset" }),
  };
}

/**
 * Runs `work` and streams what it sends. If the client goes away, the work still
 * finishes (the reply is saved and shown when the customer comes back).
 */
export function replyStreamResponse(
  work: (send: ReplyStreamSend) => Promise<void>,
  failureMessage = "The reply could not be finished. Please try again.",
) {
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: ReplyStreamSend = (event) => {
        if (!open) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false; // The client disconnected.
        }
      };

      // Not awaited: lines are delivered as soon as they are enqueued.
      void (async () => {
        try {
          await work(send);
        } catch (error) {
          console.error("[reply-stream] Streaming request failed:", error);
          send({ type: "error", error: failureMessage });
        } finally {
          if (open) {
            open = false;

            try {
              controller.close();
            } catch {
              // Already closed.
            }
          }
        }
      })();
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${REPLY_STREAM_CONTENT_TYPE}; charset=utf-8`,
      // no-transform: compression would hold the lines back until the reply is complete.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
