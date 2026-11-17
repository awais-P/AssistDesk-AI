"use client";

import type { VoiceCallStatus, VoiceTurn } from "./use-voice-call";

const statusLabel: Record<VoiceCallStatus, string> = {
  idle: "",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Call not connected",
};

function formatLatency(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The call in progress, shown above the conversation (Module 6 voice channel). */
export function VoiceCallPanel({
  agentName,
  primaryColor,
  status,
  turns,
  interim,
  error,
  muted,
  lastLatencyMs,
  onEnd,
  onToggleMute,
  onDismiss,
}: {
  agentName: string;
  primaryColor: string;
  status: VoiceCallStatus;
  turns: VoiceTurn[];
  interim: string;
  error: string;
  muted: boolean;
  lastLatencyMs: number | null;
  onEnd: () => void;
  onToggleMute: () => void;
  onDismiss: () => void;
}) {
  const live = status !== "ended" && status !== "error";
  const recent = turns.slice(-4);

  return (
    <section
      className="mx-4 mt-3 rounded-[22px] border bg-white p-4 shadow-sm"
      style={{ borderColor: `${primaryColor}55` }}
      aria-label={`Voice call with ${agentName}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${
            status === "speaking" || status === "listening" ? "" : "opacity-80"
          }`}
          style={{ backgroundColor: primaryColor }}
          aria-hidden="true"
        >
          {status === "speaking" || status === "listening" ? (
            <span className="absolute inset-0 animate-ping rounded-full opacity-30" style={{ backgroundColor: primaryColor }} />
          ) : null}
          <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{agentName}</p>
          <p className="text-xs text-slate-500" role="status" aria-live="polite">
            {statusLabel[status]}
            {muted && live ? " · microphone off" : ""}
            {lastLatencyMs !== null ? (
              <span title="Time from the end of your sentence until the answer started playing">
                {" "}
                · answered in {formatLatency(lastLatencyMs)}
              </span>
            ) : null}
          </p>
        </div>
        {live ? (
          <>
            <button
              type="button"
              onClick={onToggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Turn the microphone on" : "Mute the microphone"}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 ${muted ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4Z" />
                <path d="M7 11.5a5 5 0 0 0 10 0M12 16.5V20" />
                {muted ? <path d="m4 4 16 16" /> : null}
              </svg>
            </button>
            <button
              type="button"
              onClick={onEnd}
              aria-label="End the call"
              className="flex h-9 items-center gap-1.5 rounded-full bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600"
            >
              End
            </button>
          </>
        ) : (
          <button type="button" onClick={onDismiss} className="h-9 rounded-full px-3 text-xs text-slate-500 hover:bg-slate-100">
            Close
          </button>
        )}
      </div>

      {recent.length > 0 || interim ? (
        <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm" aria-label="Call transcript">
          {recent.map((turn) => (
            <li key={turn.id} className={turn.role === "caller" ? "text-slate-500" : "text-slate-800"}>
              <span className="font-medium">{turn.role === "caller" ? "You" : agentName}:</span> {turn.text}
            </li>
          ))}
          {interim ? (
            <li className="italic text-slate-400" aria-label="You are saying">
              {interim}…
            </li>
          ) : null}
        </ol>
      ) : live && status === "listening" ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500">Go ahead, I&apos;m listening.</p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-red-500" role="alert">
          {error}
        </p>
      ) : null}
      {status === "ended" && turns.length > 0 ? (
        <p className="mt-2 text-xs text-slate-400">The call transcript is saved with your conversation.</p>
      ) : null}
    </section>
  );
}
