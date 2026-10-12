import { notFound, redirect } from "next/navigation";
import { LeadDetailWorkspace } from "@/src/components/dashboard/lead-detail-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { loadLeadDetail } from "@/src/lib/lead-detail";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";

type LeadDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function resolveTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const [{ id }, session] = await Promise.all([params, getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const [detail, users, settings] = await Promise.all([
    loadLeadDetail(workspaceId, id),
    prisma.user.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    prisma.workspaceSetting.findUnique({
      where: { workspaceId },
      select: { timezone: true },
    }),
  ]);

  if (!detail) {
    notFound();
  }

  const isManager = hasRole(session.user.role, "MANAGER");

  return (
    <LeadDetailWorkspace
      initialDetail={detail}
      users={users}
      currentUserId={session.user.id}
      timeZone={resolveTimeZone(settings?.timezone)}
      canDelete={isManager}
      canResend={isManager}
    />
  );
}
