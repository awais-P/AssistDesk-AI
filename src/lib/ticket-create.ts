import { Prisma } from "@/app/generated/prisma/client";
import type { TicketPriority, TicketSource, TicketStatus } from "@/app/generated/prisma/enums";
import { findOrCreateContactByEmail } from "./contacts";
import { prisma } from "./prisma";

/**
 * Creates a ticket with its first customer message: used by the dashboard and the public
 * API (Module 11). The number is max+1 per workspace, so two creates at the same moment
 * can pick the same one; that conflict is retried (BUG-07). The requester's Contact links
 * the ticket to their chats on other channels (Module 5).
 */

export const FIRST_TICKET_NUMBER = 458103;
const MAX_CREATE_ATTEMPTS = 3;

export class TicketNumberConflictError extends Error {}

export async function createTicketWithMessage(input: {
  workspaceId: string;
  subject: string;
  previewText?: string | null;
  message: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
  priority?: TicketPriority;
  status?: TicketStatus;
  source?: TicketSource;
  createdById?: string | null;
  assigneeId?: string | null;
}) {
  const inbox = await prisma.inbox.findFirst({
    where: { workspaceId: input.workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const contact = input.requesterEmail
    ? await findOrCreateContactByEmail(input.workspaceId, input.requesterEmail, input.requesterName ?? null)
    : null;

  for (let attempt = 1; ; attempt += 1) {
    const lastTicket = await prisma.ticket.findFirst({
      where: { workspaceId: input.workspaceId },
      orderBy: { ticketNumber: "desc" },
      select: { ticketNumber: true },
    });

    try {
      const ticket = await prisma.ticket.create({
        data: {
          workspaceId: input.workspaceId,
          inboxId: inbox?.id,
          assigneeId: input.assigneeId ?? null,
          createdById: input.createdById ?? null,
          ticketNumber: lastTicket ? lastTicket.ticketNumber + 1 : FIRST_TICKET_NUMBER,
          subject: input.subject,
          previewText: input.previewText || null,
          requesterName: input.requesterName || null,
          requesterEmail: input.requesterEmail || null,
          contactId: contact?.id ?? null,
          priority: input.priority ?? "MEDIUM",
          status: input.status ?? "OPEN",
          source: input.source ?? "WEB",
        },
        select: { id: true },
      });

      await prisma.ticketMessage.create({
        data: {
          workspaceId: input.workspaceId,
          ticketId: ticket.id,
          sender: "USER",
          content: input.message,
          authorName: input.requesterName || null,
        },
      });

      return ticket.id;
    } catch (error) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

      if (!conflict) {
        throw error;
      }

      if (attempt >= MAX_CREATE_ATTEMPTS) {
        throw new TicketNumberConflictError("Several tickets were created at once. Please try again.");
      }
    }
  }
}
