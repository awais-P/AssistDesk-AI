import { redirect } from "next/navigation";
import { LeadSettingsWorkspace } from "@/src/components/dashboard/lead-settings-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";

/** Module 8 FE-3 / FE-4: lead notifications, automatic capture and outgoing webhooks. */
export default async function LeadSettingsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <LeadSettingsWorkspace canManage={hasRole(session.user.role, "ADMIN")} />;
}
