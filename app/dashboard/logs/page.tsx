import { redirect } from "next/navigation";
import { LogsWorkspace } from "@/src/components/dashboard/logs-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function LogsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const logs = await prisma.automationLog.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    include: {
      ticket: {
        select: {
          ticketNumber: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return (
    <LogsWorkspace
      initialLogs={logs.map((log) => ({
        id: log.id,
        date: new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(log.createdAt),
        status: `${log.action} / ${log.status}`,
        model: log.model || "System",
        tokens: log.tokens,
        duration: `${(log.durationMs / 1000).toFixed(2)}s`,
        ticketId: log.ticket?.ticketNumber
          ? `#${log.ticket.ticketNumber}`
          : "No ticket",
      }))}
    />
  );
}
