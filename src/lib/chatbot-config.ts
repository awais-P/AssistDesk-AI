export const chatbotColorOptions = [
  "#3b82f6",
  "#2563eb",
  "#14b8a6",
  "#f97316",
  "#ec4899",
  "#111827",
] as const;

export const defaultChatbotWelcomeMessage =
  "Hi! How can I help you today?";

export const widgetPositionOptions = [
  { value: "BOTTOM_RIGHT", label: "Bottom Right" },
  { value: "BOTTOM_LEFT", label: "Bottom Left" },
] as const;

export const chatbotReplyModeOptions = [
  {
    value: "ALWAYS",
    label: "Always",
    description: "AI answers every message instantly.",
  },
  {
    value: "OPERATOR_OFFLINE",
    label: "Operator Offline",
    description:
      "AI answers only when no team member is online in the dashboard; otherwise the visitor is told a team member will reply.",
  },
  {
    value: "FALLBACK",
    label: "Fallback",
    description:
      "If a team member is online, wait N seconds for a human reply, then the AI answers.",
  },
] as const;

export type WidgetPosition = (typeof widgetPositionOptions)[number]["value"];
export type ChatbotReplyMode =
  (typeof chatbotReplyModeOptions)[number]["value"];

export const defaultChatbotSettings = {
  aiRepliesEnabled: true,
  replyMode: "ALWAYS" as ChatbotReplyMode,
  widgetPosition: "BOTTOM_RIGHT" as WidgetPosition,
  requireName: false,
  requireEmail: true,
  requirePhone: false,
  emailNotifications: true,
  additionalPrompt: "",
};

export const maxConversationStarters = 4;
export const maxConversationStarterLength = 80;
export const maxAiMessagesLimit = 1000;
export const minFallbackDelaySeconds = 10;
export const maxFallbackDelaySeconds = 600;
export const defaultFallbackDelaySeconds = 60;
// Module 5: widget session idle timeout and per-conversation message rate limit
// (the server clamps to the same ranges in session-lifecycle.ts / rate-limit.ts).
export const minSessionTimeoutMinutes = 5;
export const maxSessionTimeoutMinutes = 24 * 60;
export const defaultSessionTimeoutMinutes = 30;
export const minRateLimitPerMinute = 1;
export const maxRateLimitPerMinute = 120;
export const defaultRateLimitPerMinute = 10;
export const maxAvatarBytes = 1024 * 1024;
export const avatarMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export const allowedDomainsHelpText =
  "Subdomains are included automatically. Add localhost to test locally.";

// Mirrors the server rule in src/lib/setup.ts, which cannot be imported by client components.
const chatbotDomainPattern =
  /^(localhost|([a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})$/;

export function normalizeChatbotDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

export function isValidChatbotDomain(value: string) {
  return chatbotDomainPattern.test(value);
}

/**
 * Normalizes a domain typed by the user and checks it against the domains
 * already added. Returns either the domain to add or a human-readable error.
 */
export function parseChatbotDomainInput(
  value: string,
  existingDomains: string[],
): { domain: string; error?: undefined } | { domain?: undefined; error: string } {
  const domain = normalizeChatbotDomain(value);

  if (!domain) {
    return { error: "Enter a domain, for example example.com." };
  }

  if (!isValidChatbotDomain(domain)) {
    return {
      error: `"${domain}" is not a valid domain. Use a format like example.com or shop.example.com.`,
    };
  }

  if (existingDomains.includes(domain)) {
    return { error: `${domain} is already in the list.` };
  }

  return { domain };
}

export function getChatbotInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "A";
}

export function isValidHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function sanitizeHexColor(value: string) {
  const normalized = value.trim();

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase();
  }

  return "#3b82f6";
}

export function formatWidgetPositionLabel(value: string) {
  const option = widgetPositionOptions.find((item) => item.value === value);
  return option?.label ?? "Bottom Right";
}

export function formatReplyModeLabel(value: string) {
  const option = chatbotReplyModeOptions.find((item) => item.value === value);
  return option?.label ?? "Always";
}

export function buildEmbedSnippet({
  widgetId,
  baseUrl,
  position,
}: {
  widgetId: string;
  baseUrl: string;
  position: string;
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  return `<script>
  window.assistDeskWidget = {
    widgetId: "${widgetId}",
    position: "${position}"
  };
</script>
<script src="${normalizedBaseUrl}/assistdesk-widget.js" async></script>`;
}
