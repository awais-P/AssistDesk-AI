/**
 * The one set of template variables shared by the canned response editor and the
 * ticket reply composer (BUG-18). Templates saved before this module existed used
 * `{{ticket.subject}}`-style names, so those spellings are still understood.
 */

export const cannedVariables = [
  { key: "customer_name", label: "Customer name" },
  { key: "customer_email", label: "Customer email" },
  { key: "ticket_number", label: "Ticket number" },
  { key: "subject", label: "Subject" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "agent_name", label: "Agent name" },
  { key: "created_date", label: "Created date" },
] as const;

export type CannedVariableKey = (typeof cannedVariables)[number]["key"];

export type CannedVariableValues = Record<CannedVariableKey, string>;

const variableKeys = new Set<string>(cannedVariables.map((variable) => variable.key));

const legacyAliases: Record<string, CannedVariableKey> = {
  "requester.name": "customer_name",
  "requester.email": "customer_email",
  "customer.name": "customer_name",
  "customer.email": "customer_email",
  "ticket.id": "ticket_number",
  ticket_id: "ticket_number",
  "ticket.number": "ticket_number",
  "ticket.subject": "subject",
  "ticket.status": "status",
  "ticket.priority": "priority",
  "ticket.created_at": "created_date",
  "agent.name": "agent_name",
};

export function cannedVariableToken(key: CannedVariableKey) {
  return `{{${key}}}`;
}

function resolveVariableKey(name: string): CannedVariableKey | null {
  const normalized = name.trim().toLowerCase();

  if (variableKeys.has(normalized)) {
    return normalized as CannedVariableKey;
  }

  return legacyAliases[normalized] ?? null;
}

/** Replaces every known `{{variable}}` in the template; unknown ones are left as typed. */
export function applyCannedVariables(template: string, values: CannedVariableValues) {
  return template.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (match, name: string) => {
    const key = resolveVariableKey(name);
    return key ? values[key] : match;
  });
}

/** "IN_PROGRESS" -> "In Progress", used for statuses, priorities and channels. */
export function formatTicketLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

export type MarkdownFormat = "bold" | "italic" | "bullet" | "numbered" | "link";

/**
 * Applies a Markdown format to the selected text of a textarea value and returns the
 * new value plus the selection to restore, for the reply composer and canned editor.
 */
export function applyMarkdownFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  format: MarkdownFormat,
) {
  const selected = value.slice(selectionStart, selectionEnd);
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);

  if (format === "bold" || format === "italic") {
    const marker = format === "bold" ? "**" : "_";
    const text = selected || (format === "bold" ? "bold text" : "italic text");
    const start = selectionStart + marker.length;

    return {
      value: `${before}${marker}${text}${marker}${after}`,
      selectionStart: start,
      selectionEnd: start + text.length,
    };
  }

  if (format === "link") {
    const text = selected || "link text";
    const start = selectionStart + text.length + 3;

    return {
      value: `${before}[${text}](https://)${after}`,
      selectionStart: start,
      selectionEnd: start + "https://".length,
    };
  }

  const lines = (selected || "List item").split("\n");
  const prefixed = lines
    .map((line, index) => `${format === "bullet" ? "- " : `${index + 1}. `}${line}`)
    .join("\n");
  const needsNewline = before.length > 0 && !before.endsWith("\n");
  const inserted = `${needsNewline ? "\n" : ""}${prefixed}`;

  return {
    value: `${before}${inserted}${after}`,
    selectionStart: selectionStart + (needsNewline ? 1 : 0),
    selectionEnd: selectionStart + inserted.length,
  };
}
