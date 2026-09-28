import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/src/components/dashboard/settings-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function SettingsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [workspace, settings] = await Promise.all([
    prisma.workspace.findUnique({
      where: {
        id: session.user.workspaceId,
      },
      select: {
        id: true,
        name: true,
        supportEmail: true,
      },
    }),
    prisma.workspaceSetting.findUnique({
      where: {
        workspaceId: session.user.workspaceId,
      },
    }),
  ]);

  if (!workspace) {
    redirect("/dashboard/tickets");
  }

  return (
    <SettingsWorkspace
      initialWorkspace={{
        name: workspace.name,
        supportEmail: workspace.supportEmail || session.user.email,
      }}
      initialSettings={{
        timezone: settings?.timezone || "Asia/Karachi",
        theme: settings?.theme || "dark",
        supportSignature:
          settings?.supportSignature || "Best regards,\nAssistDesk Support Team",
      }}
    />
  );
}
