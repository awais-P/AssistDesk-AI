import { redirect } from "next/navigation";
import { EscalationSettingsWorkspace } from "@/src/components/dashboard/escalation-settings-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";

/** Module 9: when conversations are escalated to the team, and the response time. */
export default async function EscalationSettingsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <EscalationSettingsWorkspace canManage={hasRole(session.user.role, "ADMIN")} />;
}
