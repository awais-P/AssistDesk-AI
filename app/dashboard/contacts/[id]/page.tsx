import { notFound, redirect } from "next/navigation";
import { ContactDetailWorkspace } from "@/src/components/dashboard/contact-detail-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { loadContactDetail } from "@/src/lib/contact-list";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";

type ContactDetailPageProps = {
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

export default async function ContactDetailPage({ params }: ContactDetailPageProps) {
  const [{ id }, session] = await Promise.all([params, getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const [detail, settings] = await Promise.all([
    loadContactDetail(workspaceId, id),
    prisma.workspaceSetting.findUnique({
      where: { workspaceId },
      select: { timezone: true },
    }),
  ]);

  if (!detail) {
    notFound();
  }

  return (
    <ContactDetailWorkspace
      initialDetail={detail}
      timeZone={resolveTimeZone(settings?.timezone)}
      canErase={hasRole(session.user.role, "MANAGER")}
    />
  );
}
