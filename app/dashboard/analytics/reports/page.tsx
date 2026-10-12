import { redirect } from "next/navigation";
import { AnalyticsReportsWorkspace } from "@/src/components/dashboard/analytics-reports-workspace";
import { loadAnalyticsReports, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";

type AnalyticsReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toSearchParams(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;

    if (first) {
      search.set(key, first);
    }
  }

  return search;
}

/** Module 4 FE-4 / FE-1: frequently asked questions and customer behaviour. */
export default async function AnalyticsReportsPage({ searchParams }: AnalyticsReportsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const timeZone = await workspaceTimeZone(workspaceId);
  const range = parseAnalyticsRange(toSearchParams(params), timeZone);
  const data = await loadAnalyticsReports(workspaceId, range);

  return <AnalyticsReportsWorkspace data={data} canExport={hasRole(session.user.role, "MANAGER")} />;
}
