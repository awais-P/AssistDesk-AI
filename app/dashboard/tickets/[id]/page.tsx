import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";
import { TicketDetailWorkspace } from "@/src/components/dashboard/ticket-detail-workspace";

type TicketDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function TicketDetailPage({
  params,
}: TicketDetailPageProps) {
  const [{ id }, , session] = await Promise.all([
    params,
    ensureDemoData(),
    getCurrentSession(),
  ]);

  if (!session) {
    redirect("/login");
  }

  const [ticket, cannedResponses, users, tags] = await Promise.all([
    prisma.ticket.findFirst({
      where: {
        id,
        workspaceId: session.user.workspaceId,
      },
      include: {
        inbox: true,
        assignee: true,
        createdBy: true,
        ticketTags: {
          include: {
            tag: true,
          },
        },
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
        logs: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    }),
    prisma.cannedResponse.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.user.findMany({
      where: {
        workspaceId: session.user.workspaceId,
        isActive: true,
      },
      orderBy: {
        fullName: "asc",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    }),
    prisma.tag.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
  ]);

  if (!ticket) {
    notFound();
  }

  return (
    <TicketDetailWorkspace
      currentUser={{
        id: session.user.id,
        fullName: session.user.fullName,
        email: session.user.email,
      }}
      ticket={{
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
        updatedAt: ticket.updatedAt.toISOString(),
        inbox: ticket.inbox
          ? {
              id: ticket.inbox.id,
              name: ticket.inbox.name,
              emailPrefix: ticket.inbox.emailPrefix,
            }
          : null,
        assignee: ticket.assignee
          ? {
              id: ticket.assignee.id,
              fullName: ticket.assignee.fullName,
              email: ticket.assignee.email,
            }
          : null,
        tags: ticket.ticketTags.map((item) => ({
          id: item.tag.id,
          name: item.tag.name,
          color: item.tag.color,
        })),
        messages: ticket.messages.map((message) => ({
          id: message.id,
          sender: message.sender,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        logs: ticket.logs.map((log) => ({
          id: log.id,
          action: log.action,
          status: log.status,
          model: log.model,
          tokens: log.tokens,
          durationMs: log.durationMs,
          summary: log.summary,
          createdAt: log.createdAt.toISOString(),
        })),
      }}
      cannedResponses={cannedResponses.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
      }))}
      users={users}
      tags={tags}
    />
  );
}
