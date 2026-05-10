import { redirect } from "next/navigation";
import { ReportsWorkspace } from "@/src/components/dashboard/reports-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

export default async function ReportsPage() {
  const [, session] = await Promise.all([ensureDemoData(), getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const [tickets, users] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      include: {
        assignee: true,
      },
    }),
    prisma.user.findMany({
      where: {
        workspaceId: session.user.workspaceId,
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
