/**
 * Reusable AI prompt templates with dynamic {{variables}} (SRS FR-9.6).
 * Variables are substituted with live ticket data when a draft is generated.
 */

export const PROMPT_NAME_MAX_LENGTH = 80;
export const PROMPT_BODY_MAX_LENGTH = 8000;

export const promptTemplateVariables = [
  {
    key: "ticket",
    description: "Full ticket thread: subject and messages (internal notes are excluded).",
    sample:
      "Subject: Can't log in after password reset\n\nConversation:\nuser: I reset my password but the login page still says it's wrong.",
  },
  {
    key: "instructions",
    description: "Extra instructions typed by the agent when generating the draft.",
    sample: "Mention that the reset link expires after 30 minutes.",
  },
  { key: "customer_name", description: "Name of the customer who raised the ticket.", sample: "Sara Khan" },
  { key: "customer_email", description: "Email address of the customer.", sample: "sara@example.com" },
  { key: "subject", description: "Ticket subject line.", sample: "Can't log in after password reset" },
  { key: "ticket_number", description: "Ticket number, e.g. 1042.", sample: "1042" },
  { key: "status", description: "Current ticket status.", sample: "Open" },
  { key: "priority", description: "Current ticket priority.", sample: "High" },
  { key: "agent_name", description: "Name of the agent generating the draft.", sample: "Ali Raza" },
  { key: "workspace_name", description: "Name of your workspace.", sample: "Acme Support" },
] as const;

export type PromptTemplateVariableKey = (typeof promptTemplateVariables)[number]["key"];

export type PromptTemplateValues = Partial<Record<PromptTemplateVariableKey, string>>;

export const samplePromptValues: PromptTemplateValues = Object.fromEntries(
  promptTemplateVariables.map((variable) => [variable.key, variable.sample]),
);

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const knownVariableKeys = new Set<string>(promptTemplateVariables.map((variable) => variable.key));

/**
 * Replaces {{variable}} placeholders with the given plain-text values. Unknown
 * variables (or known ones without a value) are left untouched.
 */
export function renderPromptTemplate(body: string, values: PromptTemplateValues) {
  return body.replace(VARIABLE_PATTERN, (match, key: string) => {
    const normalizedKey = key.toLowerCase();

    if (!knownVariableKeys.has(normalizedKey)) {
      return match;
    }

    const value = values[normalizedKey as PromptTemplateVariableKey];

    return typeof value === "string" ? value : match;
  });
}

/** Returns the distinct variable names used in a template body, in order of appearance. */
export function extractTemplateVariables(body: string) {
  const found: string[] = [];

  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    const key = match[1].toLowerCase();

    if (!found.includes(key)) {
      found.push(key);
    }
  }

  return found;
}

export function isKnownTemplateVariable(key: string) {
  return knownVariableKeys.has(key.toLowerCase());
}

/**
 * Validates a prompt name/body pair from an API payload. Returns either the
 * trimmed values or a human-readable error.
 */
export function validatePromptTemplateInput(input: { name?: unknown; body?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";

  if (!name) {
    return { error: "Give the prompt a name so your team can find it." } as const;
  }

  if (name.length > PROMPT_NAME_MAX_LENGTH) {
    return {
      error: `The prompt name is too long. Keep it under ${PROMPT_NAME_MAX_LENGTH} characters.`,
    } as const;
  }

  if (!body) {
    return { error: "The prompt body is empty. Write the instructions the AI should follow." } as const;
  }

  if (body.length > PROMPT_BODY_MAX_LENGTH) {
    return {
      error: `The prompt body is too long (${body.length} characters). Keep it under ${PROMPT_BODY_MAX_LENGTH} characters.`,
    } as const;
  }

  return { name, body } as const;
}

export const defaultPromptTemplates = [
  {
    name: "Polite resolution reply",
    body: [
      "You are {{agent_name}} from {{workspace_name}} support.",
      "Write a polite, friendly reply to {{customer_name}} that resolves their issue using only the connected knowledge and the ticket below.",
      "Keep it short, use clear steps where helpful, and close by inviting them to reply if anything is still unclear.",
      "",
      "{{ticket}}",
      "",
      "Extra instructions from the agent: {{instructions}}",
    ].join("\n"),
  },
  {
    name: "Summarize the ticket for a teammate",
    body: [
      "Summarize ticket #{{ticket_number}} (\"{{subject}}\") for a teammate who is taking it over.",
      "Current status: {{status}}. Priority: {{priority}}.",
      "Use 3-5 bullet points: what the customer wants, what has been tried, and the recommended next step. Do not address the customer.",
      "",
      "{{ticket}}",
      "",
      "Extra instructions: {{instructions}}",
    ].join("\n"),
  },
  {
    name: "Ask for missing details",
    body: [
      "Write a short, friendly reply to {{customer_name}} asking only for the details still needed to solve their request.",
      "List the missing details as a numbered list (for example: account email, order number, screenshots or steps to reproduce).",
      "Do not guess an answer yet. Sign off as {{agent_name}}, {{workspace_name}}.",
      "",
      "{{ticket}}",
      "",
      "Extra instructions: {{instructions}}",
    ].join("\n"),
  },
];
