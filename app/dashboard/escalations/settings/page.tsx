import { redirect } from "next/navigation";
import { EscalationSettingsWorkspace } from "@/src/components/dashboard/escalation-settings-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";

/** Module 9: when conversations are escalated to the team, and the response time. */
export default async function EscalationSettingsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <EscalationSettingsWorkspace canManage={can(session.user, "escalations.settings")} />;
}
