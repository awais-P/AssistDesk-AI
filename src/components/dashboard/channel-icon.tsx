import { channelLabels } from "@/src/lib/contact-labels";

/**
 * Channel icons used across the dashboard (SRS FR-11.7): globe for Website, chat
 * bubble for WhatsApp, hash for Slack, envelope for Email, microphone for Voice.
 */
export function ChannelIcon({ channel, className = "h-3.5 w-3.5" }: { channel: string; className?: string }) {
  if (channel === "SLACK") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
      </svg>
    );
  }

  if (channel === "WHATSAPP") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8Z" />
        <path d="M9.5 9.5c.5 2 2 3.5 4 4" />
      </svg>
    );
  }

  if (channel === "EMAIL") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h16v12H4z" />
        <path d="m5 7 7 6 7-6" />
      </svg>
    );
  }

  if (channel === "VOICE") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function channelName(channel: string) {
  return channelLabels[channel] ?? channel;
}

/** Icon + channel name, as shown in tables. */
export function ChannelLabel({ channel, className = "" }: { channel: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
      <ChannelIcon channel={channel} className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      {channelName(channel)}
    </span>
  );
}
