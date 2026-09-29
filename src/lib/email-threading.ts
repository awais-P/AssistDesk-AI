/**
 * Email threading helpers (Module 5 on the email channel). Outgoing replies carry a
 * `[PREFIX-NUMBER]` reference in the subject (see mailer.ts), so a customer's answer
 * can be added to the same ticket instead of opening a new one.
 */

const TICKET_REFERENCE = /\[([A-Za-z0-9]{1,12})-(\d{1,10})\]/;

export function parseTicketReference(subject: string) {
  const match = subject.match(TICKET_REFERENCE);

  if (!match) {
    return null;
  }

  const ticketNumber = Number(match[2]);

  return Number.isSafeInteger(ticketNumber) ? { prefix: match[1].toUpperCase(), ticketNumber } : null;
}

/** "Re: Re: Fwd: Refund [AD-458103]" → "Refund". */
export function cleanReplySubject(subject: string) {
  return subject
    .replace(TICKET_REFERENCE, "")
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const QUOTE_HEADERS = [
  /^On .{4,200}wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{5,}\s*$/,
  /^From:\s.+/i,
  /^Sent from my /i,
];

/**
 * Keeps only what the customer newly wrote in a reply: cuts at the first quote
 * header ("On … wrote:", "-----Original Message-----", Outlook's "From:" block) and
 * drops ">" quoted lines. Falls back to the full text if nothing would remain.
 */
export function stripQuotedReply(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (QUOTE_HEADERS.some((pattern) => pattern.test(trimmed)) && kept.some((item) => item.trim())) {
      break;
    }

    if (trimmed.startsWith(">")) {
      continue;
    }

    kept.push(line);
  }

  const result = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result || text.trim();
}

/** Message-ID values look like "<abc@mail.example.com>"; store them without brackets. */
export function normalizeMessageId(value: string | null | undefined) {
  const id = value?.trim().replace(/^<|>$/g, "").trim();
  return id && id.length <= 300 ? id : null;
}
