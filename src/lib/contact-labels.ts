/**
 * Human-readable labels for customer (Contact) and session data. Client-safe: no
 * server imports, so dashboard client components can use it directly.
 */

export const channelLabels: Record<string, string> = {
  WEB_WIDGET: "Website",
  WHATSAPP: "WhatsApp",
  SLACK: "Slack",
  EMAIL: "Email",
  VOICE: "Voice",
};

export const closedReasonLabels: Record<string, string> = {
  IDLE_TIMEOUT: "Timed out (idle)",
  MAX_DURATION: "Reached max length",
  CLOSED_BY_CUSTOMER: "Ended by customer",
  CLOSED_BY_AGENT: "Closed by team",
};

export const resolutionLabels: Record<string, string> = {
  AI_RESOLVED: "Resolved by AI",
  HUMAN_HANDLED: "Handled by team",
  UNANSWERED: "Unanswered",
};

export const sessionStatusLabels: Record<string, string> = {
  ACTIVE: "Active",
  ESCALATED: "With the team",
  CLOSED: "Closed",
};

export const sessionEventLabels: Record<string, string> = {
  SESSION_STARTED: "Conversation started",
  SESSION_RESUMED: "Returned — context carried over",
  SESSION_EXPIRED: "Conversation timed out",
  SESSION_CLOSED: "Conversation closed",
  CHANNEL_LINKED: "Channel linked",
  CONTACT_CREATED: "First seen",
  CONTACTS_MERGED: "Duplicate records merged",
  CONTEXT_CARRIED: "Memory used in a reply",
  RATE_LIMITED: "Rate limited",
  HUMAN_TAKEOVER: "Team took over",
  AI_RESUMED: "Handed back to AI",
  AI_LIMIT_REACHED: "AI reply limit reached",
  MEMORY_EDITED: "Memory edited",
  AI_FALLBACK_REPLY: "Fallback reply",
};

export function humanizeEnum(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function labelFrom(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return labels[value] ?? humanizeEnum(value);
}

export function channelBadgeClass(channel: string) {
  const base = "inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium";

  if (channel === "WEB_WIDGET") {
    return `${base} border-sky-500/30 bg-sky-500/10 text-sky-200`;
  }

  if (channel === "WHATSAPP") {
    return `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`;
  }

  if (channel === "SLACK") {
    return `${base} border-violet-500/30 bg-violet-500/10 text-violet-200`;
  }

  if (channel === "EMAIL") {
    return `${base} border-amber-500/30 bg-amber-500/10 text-amber-200`;
  }

  return `${base} border-white/10 bg-[#111111] text-slate-300`;
}

/** What to call a customer when we don't know their name. */
export function contactDisplayName(contact: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  return contact.name || contact.email || contact.phone || "Anonymous visitor";
}
