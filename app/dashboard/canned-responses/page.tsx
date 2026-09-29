import { redirect } from "next/navigation";
import { CannedResponsesWorkspace } from "@/src/components/dashboard/canned-responses-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

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

export default async function CannedResponsesPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [cannedResponses, settings] = await Promise.all([
    prisma.cannedResponse.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        title: true,
        body: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    }),
    prisma.workspaceSetting.findUnique({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        timezone: true,
      },
    }),
  ]);

  return (
    <CannedResponsesWorkspace
      initialResponses={cannedResponses.map((response) => ({
        id: response.id,
        title: response.title,
        body: response.body,
        createdAt: response.createdAt.toISOString(),
      }))}
      timeZone={resolveTimeZone(settings?.timezone)}
    />
  );
}
