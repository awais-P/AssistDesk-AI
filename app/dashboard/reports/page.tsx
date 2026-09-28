import { redirect } from "next/navigation";
import { ReportsWorkspace } from "@/src/components/dashboard/reports-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function ReportsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [tickets, users] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        source: true,
        status: true,
        assignee: {
          select: {
            fullName: true,
          },
        },
      },
      take: 500,
    }),
    prisma.user.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        role: true,
      },
    }),
  ]);

  const sourceCountMap = tickets.reduce<Record<string, number>>((acc, ticket) => {
    acc[ticket.source] = (acc[ticket.source] || 0) + 1;
    return acc;
  }, {});

  const agentHandledMap = tickets.reduce<Record<string, number>>((acc, ticket) => {
    const key = ticket.assignee?.fullName || "Unassigned";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <ReportsWorkspace
      metrics={{
        totalTickets: tickets.length,
        openTickets: tickets.filter((ticket) => ticket.status === "OPEN").length,
        handledByAgents: Object.values(agentHandledMap).reduce(
          (total, count) => total + count,
          0,
        ),
        activeAgents: users.filter((user) => user.role === "AGENT").length,
        sourceBreakdown: sourceCountMap,
        handledByAgent: agentHandledMap,
      }}
    />
  );
}
