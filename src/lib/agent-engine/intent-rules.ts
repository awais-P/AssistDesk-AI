/**
 * Module 2 FE-4: map customer intents to actions. An admin writes rules like
 * "where is my order / track my order → track_order". Matching rules are given to the
 * model as instructions (PREFER) or force the first tool call (ALWAYS).
 * Pure functions, unit-tested.
 */

export type IntentRuleMode = "PREFER" | "ALWAYS";

export type IntentRule = {
  id: string;
  phrases: string[];
  toolKey: string;
  mode: IntentRuleMode;
};

export const MAX_INTENT_RULES = 20;
const MAX_PHRASES = 10;

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sanitises stored or submitted rules; drops rules for tools that are not available. */
export function parseIntentRules(raw: unknown, availableToolKeys?: string[]): IntentRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rules: IntentRule[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const entry = item as Record<string, unknown>;
    const toolKey = typeof entry.toolKey === "string" ? entry.toolKey.trim() : "";
    const phrases = Array.isArray(entry.phrases)
      ? [...new Set(entry.phrases.map((phrase) => (typeof phrase === "string" ? normalize(phrase).slice(0, 60) : "")).filter((phrase) => phrase.length >= 2))].slice(0, MAX_PHRASES)
      : [];

    if (!/^[a-z][a-z0-9_]{2,39}$/.test(toolKey) || phrases.length === 0) continue;
    if (availableToolKeys && !availableToolKeys.includes(toolKey)) continue;

    rules.push({
      id: typeof entry.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(entry.id) ? entry.id : `rule_${rules.length + 1}`,
      phrases,
      toolKey,
      mode: entry.mode === "ALWAYS" ? "ALWAYS" : "PREFER",
    });

    if (rules.length >= MAX_INTENT_RULES) break;
  }

  return rules;
}

/** Rules whose phrase appears in the message as whole words. */
export function matchIntentRules(message: string, rules: IntentRule[]) {
  const content = ` ${normalize(message)} `;
  return rules.filter((rule) => rule.phrases.some((phrase) => content.includes(` ${phrase} `)));
}

/** System-prompt lines that explain all rules, and highlight the ones this message matches. */
export function intentRuleInstructions(rules: IntentRule[], matched: IntentRule[]) {
  if (rules.length === 0) {
    return null;
  }

  const lines = rules.map((rule) => `- When the customer says things like "${rule.phrases.slice(0, 3).join('", "')}", use the ${rule.toolKey} tool.`);
  const hits = matched.map((rule) => rule.toolKey);

  return [
    "Business rules for choosing actions:",
    ...lines,
    hits.length ? `This message matches: ${[...new Set(hits)].join(", ")}. Use that tool unless the customer clearly wants something else.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The tool the first reasoning step must call (first matching ALWAYS rule), if any. */
export function forcedToolFor(matched: IntentRule[]) {
  return matched.find((rule) => rule.mode === "ALWAYS")?.toolKey ?? null;
}
