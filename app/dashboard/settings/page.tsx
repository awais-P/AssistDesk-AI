import { redirect } from "next/navigation";
import { SettingsWorkspace } from "@/src/components/dashboard/settings-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { hasRole, roleDescriptions, type WorkspaceRole } from "@/src/lib/rbac";

const DEFAULT_TIMEZONE = "Asia/Karachi";

/** Formats on the server with an explicit time zone so the output never depends on the host. */
function formatCreatedDate(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
  }
}

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
        slug: true,
        supportEmail: true,
        createdAt: true,
      },
    }),
    prisma.workspaceSetting.findUnique({
      where: {
        workspaceId: session.user.workspaceId,
      },
    }),
  ]);

  if (!workspace) {
    redirect("/dashboard");
  }

  const timezone = settings?.timezone || DEFAULT_TIMEZONE;
  const role = session.user.role;

  return (
    <SettingsWorkspace
      canEdit={hasRole(role, "ADMIN")}
      initialWorkspace={{
        name: workspace.name,
        supportEmail: workspace.supportEmail || session.user.email,
      }}
      initialSettings={{
        timezone,
        supportSignature:
          settings?.supportSignature || "Best regards,\nAssistDesk Support Team",
        crossChannelMemory: settings?.crossChannelMemory ?? true,
      }}
      workspaceInfo={{
        slug: workspace.slug,
        createdLabel: formatCreatedDate(workspace.createdAt, timezone),
        role,
        roleDescription: roleDescriptions[role as WorkspaceRole] ?? "",
      }}
    />
  );
}
