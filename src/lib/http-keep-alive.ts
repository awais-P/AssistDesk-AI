import { Agent, setGlobalDispatcher } from "undici";

/**
 * Latency: every reply calls outside services over HTTPS (the knowledge-search
 * embedding, then the AI model). Node closes an idle connection after 4 s, so after a
 * normal pause between chat messages each call paid a new TLS handshake: measured
 * against OpenRouter, ~780–920 ms instead of ~450 ms. Connections are now kept for 40 s
 * (OpenRouter kept them open for 45 s and more in tests), so the next message reuses
 * them. Node's built-in fetch uses this dispatcher too.
 */
export const KEEP_ALIVE_MS = 40_000;

export function enableLongKeepAlive() {
  setGlobalDispatcher(
    new Agent({
      keepAliveTimeout: KEEP_ALIVE_MS,
      // A server that announces its own limit ("Keep-Alive: timeout=…") is still respected.
      keepAliveMaxTimeout: 10 * 60_000,
    }),
  );
}
