/** Module 11 FE-2: API key scopes and limits, safe to import in the browser. */

export const API_SCOPES = [
  { key: "tickets:read", label: "Read tickets and their messages" },
  { key: "tickets:write", label: "Create tickets" },
  { key: "contacts:read", label: "Read customers" },
  { key: "contacts:write", label: "Create or update customers" },
  { key: "leads:read", label: "Read leads" },
  { key: "leads:write", label: "Create leads" },
  { key: "conversations:read", label: "Read conversations and transcripts" },
  { key: "escalations:read", label: "Read escalations" },
] as const;

export type ApiScope = (typeof API_SCOPES)[number]["key"];
export const API_SCOPE_KEYS = API_SCOPES.map((scope) => scope.key) as ApiScope[];

export const API_KEY_PREFIX = "ad_live_";
export const API_RATE_LIMIT = { limit: 120, windowSeconds: 60 };
export const MAX_API_KEYS = 20;
