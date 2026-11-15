import { redirect } from "next/navigation";
import { RolesWorkspace } from "@/src/components/dashboard/roles-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";

/** Module 11 FE-3/FE-4: permissions by role and admin-defined custom roles. */
export default async function RolesPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <RolesWorkspace canManage={can(session.user, "roles.manage")} />;
}
