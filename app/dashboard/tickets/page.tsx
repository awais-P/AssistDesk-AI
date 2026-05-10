import { redirect } from "next/navigation";
import { TicketsClient } from "@/src/components/dashboard/tickets-client";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

export default async function TicketsPage() {
  const [, session] = await Promise.all([ensureDemoData(), getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      inbox: true,
      assignee: true,
      ticketTags: {
        include: {
          tag: true,
        },
      },
    },
    orderBy: {
      ticketNumber: "asc",
    },
  });

  const initialTickets = tickets.map((ticket) => ({
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    previewText: ticket.previewText,
    requesterName: ticket.requesterName,
    requesterEmail: ticket.requesterEmail,
    source: ticket.source,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt.toISOString(),
    inboxName: ticket.inbox?.name ?? "Unassigned",
    assigneeName: ticket.assignee?.fullName ?? "Unassigned",
    assigneeInitials: (ticket.assignee?.fullName ?? "UN")
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join(""),
    tags: ticket.ticketTags.map((ticketTag) => ticketTag.tag.name),
  }));

  return (
    <TicketsClient
      initialTickets={initialTickets}
      currentUser={{
        id: session.user.id,
        fullName: session.user.fullName,
      }}
    />
  );
}
