import { redirect } from "next/navigation";
import { ConnectorsWorkspace } from "@/src/components/dashboard/connectors-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";

/** Module 11 FE-1: CRM (HubSpot) and e-commerce (Shopify) connectors. */
export default async function ConnectorsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <ConnectorsWorkspace canManage={can(session.user, "connectors.manage")} />;
}
