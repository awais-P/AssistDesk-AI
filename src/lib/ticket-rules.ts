/**
 * Parsing and matching for the ticket automations whose settings are typed as text in the
 * agent's Automations tab: the block list and the inactivity delays of "AI Follow-up" and
 * "Close Ticket". Pure functions, so they are unit-tested (UT-61) and safe in the browser.
 */

export type BlockListRules = {
  emails: string[];
  domains: string[];
  keywords: string[];
};

export type BlockListMatch = { kind: "email" | "domain" | "keyword"; rule: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^@?(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

/**
 * One rule per line or separated by commas/semicolons:
 * - `spam@example.com` blocks that address;
 * - `example.com` or `@example.com` blocks the domain and its subdomains;
 * - anything else is a keyword or phrase matched in the subject and message.
 */
export function parseBlockList(text: string | null | undefined): BlockListRules {
  const rules: BlockListRules = { emails: [], domains: [], keywords: [] };

  for (const raw of (text ?? "").split(/[\n,;]+/)) {
    const entry = raw.trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!entry) continue;

    if (EMAIL_PATTERN.test(entry)) {
      rules.emails.push(entry);
    } else if (DOMAIN_PATTERN.test(entry)) {
      rules.domains.push(entry.replace(/^@/, ""));
    } else {
      rules.keywords.push(entry.replace(/\s+/g, " "));
    }
  }

  return rules;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchBlockList(
  rules: BlockListRules,
  ticket: { email?: string | null; subject?: string | null; body?: string | null },
): BlockListMatch | null {
  const email = (ticket.email ?? "").trim().toLowerCase();
  const domain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";

  if (email) {
    const exact = rules.emails.find((rule) => rule === email);
    if (exact) return { kind: "email", rule: exact };
  }

  if (domain) {
    const byDomain = rules.domains.find((rule) => domain === rule || domain.endsWith(`.${rule}`));
    if (byDomain) return { kind: "domain", rule: byDomain };
  }

  const text = `${ticket.subject ?? ""}\n${ticket.body ?? ""}`.toLowerCase().replace(/\s+/g, " ");
  // Whole words only, so "win" does not block "window".
  const keyword = rules.keywords.find((rule) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(rule)}($|[^\\p{L}\\p{N}])`, "u").test(text),
  );

  return keyword ? { kind: "keyword", rule: keyword } : null;
}

export function describeBlockMatch(match: BlockListMatch) {
  if (match.kind === "email") return `the sender ${match.rule} is on the block list`;
  if (match.kind === "domain") return `the sender's domain ${match.rule} is on the block list`;
  return `it contains the blocked keyword "${match.rule}"`;
}

/** Shortest and longest delay accepted for the inactivity automations. */
export const MIN_INACTIVITY_HOURS = 1;
export const MAX_INACTIVITY_HOURS = 24 * 90;

/**
 * Reads a delay such as "After 24h of inactivity", "36 hours", "2 days", "1 week" or "90m".
 * Returns `fallbackHours` when no number is found; the result is kept between 1 hour and
 * 90 days so a typo can't close every ticket at once.
 */
export function parseInactivityHours(text: string | null | undefined, fallbackHours: number) {
  const match = /(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)?\b/i.exec(text ?? "");
  if (!match) return fallbackHours;

  const value = Number(match[1]);
  const unit = (match[2] ?? "h").toLowerCase();
  const hours = unit.startsWith("m")
    ? value / 60
    : unit.startsWith("d")
      ? value * 24
      : unit.startsWith("w")
        ? value * 24 * 7
        : value;

  if (!Number.isFinite(hours) || hours <= 0) return fallbackHours;
  return Math.min(MAX_INACTIVITY_HOURS, Math.max(MIN_INACTIVITY_HOURS, hours));
}
