import type { TraceEntry } from "./graph";

/**
 * Module 2 resilience: when tools ran successfully but no model could write the final
 * answer (rate limits, outages), AssistDesk answers from the tool results itself, so
 * facts already retrieved are never lost. Pure function, unit-tested.
 */

type ToolEntry = Extract<TraceEntry, { type: "tool" }>;

const statusLabels: Record<string, string> = {
  OPEN: "open and waiting for our team",
  IN_PROGRESS: "in progress — our team is working on it",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 120);
  return String(value).slice(0, 120);
}

function summarizeOne(entry: ToolEntry): string | null {
  const output = (entry.output ?? {}) as Record<string, unknown>;

  if (output.simulated) {
    return `(Test mode) ${String(output.note ?? "The action was simulated.")}`;
  }

  switch (entry.toolKey) {
    case "lookup_ticket_status":
      return output.found
        ? `Your ticket ${output.reference} ("${output.subject}") is ${statusLabels[String(output.status)] ?? String(output.status).toLowerCase()}.`
        : "I couldn't find a ticket with that reference for you. Could you check the number in your confirmation email?";
    case "create_ticket":
      return output.created ? `I've opened ticket ${output.reference} for you. ${String(output.followUp ?? "")}`.trim() : null;
    case "capture_lead":
      return output.saved ? "Thank you! Our sales team will contact you shortly." : null;
    case "escalate_to_human":
      return output.handedOver ? "I've asked a team member to join this conversation — they'll reply here shortly." : null;
    case "check_availability": {
      const slots = Array.isArray(output.slots) ? (output.slots as Array<{ label: string }>) : [];
      return slots.length
        ? `These times are available: ${slots.slice(0, 4).map((slot) => slot.label).join(", ")}. Which one suits you?`
        : "There are no free appointment slots in that period. Would another day work?";
    }
    case "book_appointment":
      return output.booked ? `Your appointment is booked for ${output.when}.` : null;
    case "get_customer_info":
    case "search_knowledge_base":
      return null;
    default: {
      // Custom HTTP tool: show the first few fields it returned.
      const fields = Object.entries(output).filter(([key]) => !["truncated", "preview"].includes(key)).slice(0, 5);
      return fields.length ? `Here's what I found: ${fields.map(([key, value]) => `${key.split(".").pop()}: ${describeValue(value)}`).join("; ")}.` : null;
    }
  }
}

/** A customer-facing reply from the successful tool results, or null if there is nothing to say. */
export function summarizeToolResults(trace: TraceEntry[]) {
  const successful = trace.filter((entry): entry is ToolEntry => entry.type === "tool" && entry.status === "SUCCESS");
  const pending = trace.find((entry): entry is ToolEntry => entry.type === "tool" && entry.status === "PENDING_CONFIRMATION");
  const lines = [...new Set(successful.map(summarizeOne).filter((line): line is string => Boolean(line)))];

  if (pending) {
    const instruction = String((pending.output as { instruction?: string })?.instruction ?? "");
    const question = instruction.match(/confirm: "([^"]+)"/)?.[1];
    lines.push(question ? `${question}` : "Shall I go ahead with that?");
  }

  return lines.length ? lines.join(" ") : null;
}
