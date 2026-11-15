import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiKeysWorkspace } from "@/src/components/dashboard/api-keys-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";

/** Module 11 FE-2: API keys for the public REST API. */
export default async function ApiKeysPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  return <ApiKeysWorkspace canManage={can(session.user, "apikeys.manage")} origin={`${protocol}://${host}`} />;
}
