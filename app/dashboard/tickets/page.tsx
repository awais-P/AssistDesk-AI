import { redirect } from "next/navigation";
import { TicketsClient } from "@/src/components/dashboard/tickets-client";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

export default async function TicketsPage() {
  await ensureDemoData();

  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
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
    assigneeName: ticket.assignee?.fullName ?? "Unassigned",
    assigneeInitials: (ticket.assignee?.fullName ?? "UN")
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join(""),
    tags: ticket.ticketTags.map((ticketTag) => ticketTag.tag.name),
  }));

  return <TicketsClient initialTickets={initialTickets} />;
}
