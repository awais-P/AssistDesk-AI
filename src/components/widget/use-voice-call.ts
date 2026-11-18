"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REPLY_STREAM_ACCEPT, isReplyStream, readReplyStream } from "@/src/lib/reply-stream-client";
import { createPhraseChunker, pcm16ToFloat32, speakableText } from "@/src/lib/voice-text";
import { WIDGET_SESSION_HEADER, WIDGET_TOKEN_HEADER } from "@/src/lib/widget-constants";

/**
 * A voice call in the website widget (Module 6 FE-6..8, FR-16.6).
 *
 *   microphone ─▶ Deepgram speech-to-text (end of speech = VAD/endpointing, FE-7)
 *   final words ─▶ POST /messages (streamed AI reply, same pipeline as the chat)
 *   reply pieces ─▶ phrases ─▶ Deepgram streaming speech (starts before the reply ends, FE-8)
 *   audio ─▶ Web Audio, back to back; the caller can talk over it (barge-in)
 *
 * Latency (FE-6): from the end of the caller's speech to the first audio of the reply,
 * measured here and reported to the server for Analytics.
 */

export type VoiceCallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export type VoiceTurn = { id: string; role: "caller" | "agent"; text: string };

type DeepgramConnection = { accessToken: string; listenUrl: string; speakUrl: string; sampleRate: number };

type VoiceIdentity = { name: string; email: string; phone: string; visitorId: string | null };

type StartResponse = { error?: string; sessionToken?: string; deepgram?: DeepgramConnection };

/** Words while the agent is talking that count as the caller interrupting it. */
const BARGE_IN_WORDS = 2;
/** Deepgram closes a listening connection after 10 s without audio or a KeepAlive. */
const KEEP_ALIVE_MS = 5_000;

function preferredRecordingType() {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

export function isVoiceSupported() {
  return (
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) !== "undefined"
  );
}

export function useVoiceCall({
  widgetId,
  widgetToken,
  identity,
  chatSessionToken,
}: {
  widgetId: string;
  widgetToken: string;
  identity: VoiceIdentity;
  chatSessionToken: string | null;
}) {
  const [status, setStatus] = useState<VoiceCallStatus>("idle");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  // Everything the call needs between events lives in refs (no re-render per audio frame).
  const call = useRef<{
    active: boolean;
    sessionToken: string | null;
    connection: DeepgramConnection | null;
    stream: MediaStream | null;
    recorder: MediaRecorder | null;
    /** Audio recorded while the speech-to-text connection was still opening. */
    pendingAudio: Blob[];
    listen: WebSocket | null;
    speak: WebSocket | null;
    speakQueue: string[];
    audio: AudioContext | null;
    sources: Set<AudioBufferSourceNode>;
    nextStart: number;
    leftover: Uint8Array | null;
    discardAudio: boolean;
    keepAlive: number | undefined;
    heard: string;
    turn: number;
    speechEndedAt: number;
    firstAudioAt: number | null;
    replyDone: boolean;
    pendingMetric: { firstAudioMs: number | null; messageId: string | null };
  }>({
    active: false,
    sessionToken: null,
    connection: null,
    stream: null,
    recorder: null,
    pendingAudio: [],
    listen: null,
    speak: null,
    speakQueue: [],
    audio: null,
    sources: new Set(),
    nextStart: 0,
    leftover: null,
    discardAudio: false,
    keepAlive: undefined,
    heard: "",
    turn: 0,
    speechEndedAt: 0,
    firstAudioAt: null,
    replyDone: true,
    pendingMetric: { firstAudioMs: null, messageId: null },
  });
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const voiceFetch = useCallback(
    (path: string, init: RequestInit) =>
      fetch(path, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          "Content-Type": "application/json",
          [WIDGET_TOKEN_HEADER]: widgetToken,
          ...(call.current.sessionToken ? { [WIDGET_SESSION_HEADER]: call.current.sessionToken } : {}),
        },
      }),
    [widgetToken],
  );

  const voiceAction = useCallback(
    (body: Record<string, unknown>) =>
      voiceFetch(`/api/widget/${widgetId}/voice`, { method: "POST", body: JSON.stringify(body) }),
    [voiceFetch, widgetId],
  );

  /** Sends the measured time to the first audio once both it and the reply's id are known. */
  const reportMetric = useCallback(() => {
    const metric = call.current.pendingMetric;

    if (metric.firstAudioMs !== null && metric.messageId) {
      void voiceAction({ action: "metrics", messageId: metric.messageId, firstAudioMs: metric.firstAudioMs }).catch(() => undefined);
      call.current.pendingMetric = { firstAudioMs: null, messageId: null };
    }
  }, [voiceAction]);

  // ------------------------------------------------------------------ speaking

  const stopSpeaking = useCallback(() => {
    const state = call.current;

    for (const source of state.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }

    state.sources.clear();
    state.nextStart = 0;
    state.leftover = null;
    state.speakQueue = [];

    if (state.speak?.readyState === WebSocket.OPEN) {
      // Audio still on its way is dropped until Deepgram confirms with "Cleared".
      state.discardAudio = true;
      state.speak.send(JSON.stringify({ type: "Clear" }));
    }
  }, []);

  const playAudio = useCallback(
    (data: ArrayBuffer) => {
      const state = call.current;

      if (!state.audio || state.discardAudio || !state.connection) {
        return;
      }

      // A sample can be split between two frames: keep the odd byte for the next one.
      let bytes = new Uint8Array(data);

      if (state.leftover) {
        const joined = new Uint8Array(state.leftover.length + bytes.length);
        joined.set(state.leftover);
        joined.set(bytes, state.leftover.length);
        bytes = joined;
        state.leftover = null;
      }

      if (bytes.length % 2 === 1) {
        state.leftover = bytes.slice(-1);
        bytes = bytes.slice(0, -1);
      }

      if (bytes.length === 0) {
        return;
      }

      const samples = pcm16ToFloat32(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      const buffer = state.audio.createBuffer(1, samples.length, state.connection.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = state.audio.createBufferSource();
      source.buffer = buffer;
      source.connect(state.audio.destination);
      const startAt = Math.max(state.audio.currentTime + 0.01, state.nextStart);
      source.start(startAt);
      state.nextStart = startAt + buffer.duration;
      state.sources.add(source);

      if (state.firstAudioAt === null) {
        // Latency as the caller hears it: until this audio actually starts playing.
        state.firstAudioAt = performance.now() + Math.max(0, startAt - state.audio.currentTime) * 1000;
        const firstAudioMs = Math.round(state.firstAudioAt - state.speechEndedAt);
        setLastLatencyMs(firstAudioMs);
        state.pendingMetric.firstAudioMs = firstAudioMs;
        reportMetric();
      }

      setStatus("speaking");
      source.onended = () => {
        state.sources.delete(source);

        if (state.sources.size === 0 && state.replyDone && state.active) {
          setStatus("listening");
        }
      };
    },
    [reportMetric],
  );

  const openSpeech = useCallback(
    (connection: DeepgramConnection) => {
      const state = call.current;
      const socket = new WebSocket(connection.speakUrl, ["bearer", connection.accessToken]);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        for (const message of state.speakQueue.splice(0)) {
          socket.send(message);
        }
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          playAudio(event.data as ArrayBuffer);
          return;
        }

        try {
          const message = JSON.parse(event.data) as { type?: string; description?: string };

          if (message.type === "Cleared") {
            state.discardAudio = false;
          } else if (message.type === "Warning") {
            console.warn("[voice] speech:", message.description);
          }
        } catch {
          // Not JSON: ignored.
        }
      };
      socket.onclose = () => {
        if (state.speak === socket) {
          state.speak = null;
        }
      };
      state.speak = socket;
    },
    [playAudio],
  );

  /** Sends a message to the speech connection, reconnecting it (new token) if it closed. */
  const sendToSpeech = useCallback(
    async (message: Record<string, unknown>) => {
      const state = call.current;
      const payload = JSON.stringify(message);

      if (state.speak?.readyState === WebSocket.OPEN) {
        state.speak.send(payload);
        return;
      }

      state.speakQueue.push(payload);

      if (state.speak?.readyState === WebSocket.CONNECTING) {
        return;
      }

      // Idle connections are closed by Deepgram: open a new one with a fresh token.
      const response = await voiceAction({ action: "token" });
      const data = (await response.json().catch(() => ({}))) as { deepgram?: DeepgramConnection };

      if (data.deepgram && state.active) {
        state.connection = data.deepgram;
        openSpeech(data.deepgram);
      }
    },
    [openSpeech, voiceAction],
  );

  // ------------------------------------------------------------------ a turn

  const answer = useCallback(
    async (said: string) => {
      const state = call.current;
      const turn = (state.turn += 1);
      const agentTurnId = `agent-${turn}`;
      const chunker = createPhraseChunker();
      let written = "";

      stopSpeaking();
      state.replyDone = false;
      state.firstAudioAt = null;
      state.pendingMetric = { firstAudioMs: null, messageId: null };
      setStatus("thinking");
      setTurns((current) => [...current, { id: `caller-${turn}`, role: "caller", text: said }]);

      const speak = (phrase: string | null) => {
        if (phrase && turn === state.turn) {
          void sendToSpeech({ type: "Speak", text: phrase });
        }
      };
      const showReply = (text: string) =>
        setTurns((current) => [...current.filter((item) => item.id !== agentTurnId), ...(text ? [{ id: agentTurnId, role: "agent" as const, text }] : [])]);

      try {
        const identityNow = identityRef.current;
        const response = await voiceFetch(`/api/widget/${widgetId}/messages`, {
          method: "POST",
          headers: { Accept: REPLY_STREAM_ACCEPT },
          body: JSON.stringify({
            message: said,
            voice: true,
            customerName: identityNow.name,
            customerEmail: identityNow.email,
            customerPhone: identityNow.phone,
            visitorId: identityNow.visitorId,
          }),
        });

        if (!isReplyStream(response) || !response.body) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "The assistant could not answer. Please try again.");
          setStatus("listening");
          return;
        }

        await readReplyStream(response.body, (event) => {
          if (turn !== state.turn) {
            return; // The caller already said something new: this reply is not spoken.
          }

          if (event.type === "start" && typeof event.sessionToken === "string") {
            state.sessionToken = event.sessionToken; // The call had timed out: a new one started.
          } else if (event.type === "delta" && typeof event.text === "string") {
            written += event.text;
            showReply(written);

            for (const phrase of chunker.push(event.text)) {
              speak(phrase);
            }
          } else if (event.type === "reset") {
            written = "";
            chunker.reset();
            showReply("");
            stopSpeaking();
          } else if (event.type === "done") {
            const messages = (event.messages as Array<{ id: string; sender: string; content: string }> | undefined) ?? [];
            const reply = messages.find((message) => message.sender === "AI") ?? messages.find((message) => message.sender === "SYSTEM");

            if (!written && reply) {
              // Not streamed (a notice, or the knowledge-base fallback): speak it whole.
              written = reply.content;
              speak(speakableText(reply.content));
            } else {
              speak(chunker.finish());
            }

            showReply(reply?.content ?? written);
            void sendToSpeech({ type: "Flush" });
            state.pendingMetric.messageId = reply?.sender === "AI" ? reply.id : null;
            reportMetric();
          } else if (event.type === "error") {
            setError(typeof event.error === "string" ? event.error : "The assistant could not answer.");
          }
        });
      } catch {
        setError("The connection dropped. Please try again.");
      } finally {
        if (turn === state.turn) {
          state.replyDone = true;

          if (state.sources.size === 0 && state.active) {
            setStatus("listening");
          }
        }
      }
    },
    [reportMetric, sendToSpeech, stopSpeaking, voiceFetch, widgetId],
  );

  // ------------------------------------------------------------------ listening

  const handleTranscript = useCallback(
    (raw: string) => {
      const state = call.current;
      let message: {
        type?: string;
        is_final?: boolean;
        speech_final?: boolean;
        last_word_end?: number;
        channel?: { alternatives?: Array<{ transcript?: string }> };
      };

      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      const commit = () => {
        const said = state.heard.trim();
        state.heard = "";
        setInterim("");

        if (said) {
          state.speechEndedAt = performance.now();
          void answer(said);
        }
      };

      if (message.type === "Results") {
        const words = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";

        // The caller talks over the agent: stop speaking at once (barge-in).
        if (words.split(/\s+/).filter(Boolean).length >= BARGE_IN_WORDS && state.sources.size > 0) {
          stopSpeaking();
          state.turn += 1; // The reply being spoken is dropped.
          setStatus("listening");
        }

        if (message.is_final) {
          if (words) {
            state.heard = `${state.heard} ${words}`.trim();
          }

          setInterim(state.heard);

          if (message.speech_final) {
            commit();
          }
        } else {
          setInterim(`${state.heard} ${words}`.trim());
        }
      } else if (message.type === "UtteranceEnd" && message.last_word_end !== -1) {
        commit();
      }
    },
    [answer, stopSpeaking],
  );

  // ------------------------------------------------------------------ start / end

  const cleanUp = useCallback(() => {
    const state = call.current;
    state.active = false;
    window.clearInterval(state.keepAlive);

    try {
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
    } catch {
      // Already stopped.
    }

    state.stream?.getTracks().forEach((track) => track.stop());

    if (state.listen?.readyState === WebSocket.OPEN) {
      state.listen.send(JSON.stringify({ type: "CloseStream" }));
    }

    if (state.speak?.readyState === WebSocket.OPEN) {
      state.speak.send(JSON.stringify({ type: "Close" }));
    }

    state.listen?.close();
    state.speak?.close();

    for (const source of state.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }

    void state.audio?.close().catch(() => undefined);
    Object.assign(state, { listen: null, speak: null, recorder: null, stream: null, audio: null, speakQueue: [], pendingAudio: [], heard: "" });
    state.sources.clear();
  }, []);

  const end = useCallback(async () => {
    const wasActive = call.current.active;
    cleanUp();
    setInterim("");
    setStatus("ended");

    if (wasActive && call.current.sessionToken) {
      await voiceAction({ action: "end" }).catch(() => undefined);
    }
  }, [cleanUp, voiceAction]);

  const start = useCallback(async () => {
    const state = call.current;

    if (state.active) {
      return;
    }

    setError("");
    setTurns([]);
    setInterim("");
    setLastLatencyMs(null);
    setMuted(false);
    setStatus("connecting");
    state.sessionToken = null;
    state.turn = 0;

    try {
      // Created inside the click, so browsers allow it to play sound.
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      state.audio = new AudioContextClass();
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      // Recording starts now, not once Deepgram is connected: a caller who talks straight
      // away is not cut off. Audio is held until the connection opens, then sent in order.
      const mimeType = preferredRecordingType();
      const recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
      state.pendingAudio = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) {
          return;
        }

        if (state.listen?.readyState === WebSocket.OPEN) {
          state.listen.send(event.data);
        } else {
          state.pendingAudio.push(event.data);
        }
      };
      // Small pieces: the words reach speech-to-text within a tenth of a second.
      recorder.start(100);
      state.recorder = recorder;
    } catch {
      cleanUp();
      setError("Microphone access was blocked. Allow it in your browser to call.");
      setStatus("error");
      return;
    }

    const identityNow = identityRef.current;
    const response = await voiceAction({
      action: "start",
      chatSessionToken,
      customerName: identityNow.name,
      customerEmail: identityNow.email,
      customerPhone: identityNow.phone,
      visitorId: identityNow.visitorId,
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as StartResponse | undefined;

    if (!response?.ok || !data?.sessionToken || !data.deepgram) {
      cleanUp();
      setError(data?.error ?? "The call could not be connected. Please try again.");
      setStatus("error");
      return;
    }

    state.active = true;
    state.sessionToken = data.sessionToken;
    state.connection = data.deepgram;

    // Speech is opened right away, so the first reply doesn't wait for a connection.
    openSpeech(data.deepgram);

    const listen = new WebSocket(data.deepgram.listenUrl, ["bearer", data.deepgram.accessToken]);
    state.listen = listen;
    listen.onmessage = (event) => {
      if (typeof event.data === "string") handleTranscript(event.data);
    };
    listen.onerror = () => setError("The voice connection had a problem.");
    listen.onclose = () => {
      if (state.active && state.listen === listen) {
        setError("The call was disconnected.");
        void end();
      }
    };
    listen.onopen = () => {
      for (const chunk of state.pendingAudio.splice(0)) {
        listen.send(chunk);
      }

      state.keepAlive = window.setInterval(() => {
        if (listen.readyState === WebSocket.OPEN) listen.send(JSON.stringify({ type: "KeepAlive" }));
      }, KEEP_ALIVE_MS);
      setStatus("listening");
    };
  }, [chatSessionToken, cleanUp, end, handleTranscript, openSpeech, voiceAction]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      call.current.stream?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  /** Closes the panel of a call that has ended (or failed to start). */
  const dismiss = useCallback(() => {
    if (!call.current.active) {
      setStatus("idle");
      setError("");
    }
  }, []);

  // Leaving the page ends the call.
  useEffect(() => () => cleanUp(), [cleanUp]);

  return { status, turns, interim, error, muted, lastLatencyMs, start, end, toggleMute, dismiss };
}
