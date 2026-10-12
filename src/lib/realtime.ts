import { EventEmitter } from "node:events";

/**
 * Real-time conversation updates (Module 5 "Real-Time Context", SRS CI-1, PER-3).
 *
 * Every new message or status change publishes an event. Server-Sent Event streams
 * subscribe to it and push the change to the widget / dashboard immediately. Events
 * only reach streams on the same server instance, so every stream also re-checks the
 * database every couple of seconds; on a multi-instance deployment updates still
 * arrive within that interval.
 */

export type ConversationEvent = {
  workspaceId: string;
  sessionId: string;
  type: "message" | "status" | "session";
};

declare global {
  var assistdeskRealtimeBus: EventEmitter | undefined;
}

const bus = global.assistdeskRealtimeBus ?? new EventEmitter();
bus.setMaxListeners(1000);
global.assistdeskRealtimeBus = bus;

export function publishConversationEvent(event: ConversationEvent) {
  bus.emit(`session:${event.sessionId}`, event);
  bus.emit(`workspace:${event.workspaceId}`, event);
}

export function subscribeToSession(sessionId: string, listener: (event: ConversationEvent) => void) {
  bus.on(`session:${sessionId}`, listener);
  return () => bus.off(`session:${sessionId}`, listener);
}

export function subscribeToWorkspace(workspaceId: string, listener: (event: ConversationEvent) => void) {
  bus.on(`workspace:${workspaceId}`, listener);
  return () => bus.off(`workspace:${workspaceId}`, listener);
}

type StreamOptions = {
  request: Request;
  /** Called on connect, on every event and on every poll tick; returns payloads to send. */
  poll: () => Promise<Array<{ event: string; data: unknown }>>;
  subscribe: (wake: () => void) => () => void;
  pollIntervalMs?: number;
  /** Streams end after this long; EventSource reconnects automatically (serverless-friendly). */
  maxDurationMs?: number;
};

/**
 * Builds a Server-Sent Events response that pushes whatever `poll` returns, woken
 * immediately by the event bus and at least every `pollIntervalMs`.
 */
export function createEventStream({
  request,
  poll,
  subscribe,
  pollIntervalMs = 2000,
  maxDurationMs = 55_000,
}: StreamOptions) {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => undefined;
  let timer: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let running = false;
      let rerun = false;

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        unsubscribe();
        if (timer) clearInterval(timer);
        if (heartbeat) clearInterval(heartbeat);
        if (deadline) clearTimeout(deadline);

        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      const send = (event: string, data: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
      };

      const tick = async () => {
        if (closed) {
          return;
        }

        if (running) {
          rerun = true;
          return;
        }

        running = true;

        try {
          do {
            rerun = false;

            for (const payload of await poll()) {
              send(payload.event, payload.data);
            }
          } while (rerun && !closed);
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "Stream error" });
          close();
        } finally {
          running = false;
        }
      };

      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      unsubscribe = subscribe(() => void tick());
      timer = setInterval(() => void tick(), pollIntervalMs);
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
      deadline = setTimeout(close, maxDurationMs);
      request.signal.addEventListener("abort", close);
      void tick();
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (timer) clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
