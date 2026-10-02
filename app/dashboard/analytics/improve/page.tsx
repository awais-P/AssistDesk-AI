import { redirect } from "next/navigation";
import { AnalyticsImproveWorkspace } from "@/src/components/dashboard/analytics-improve-workspace";
import { loadImprovementAreas, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";

type AnalyticsImprovePageProps = {
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

/** Module 4 FE-5 / FE-2: what to teach the assistant next, with links to transcripts. */
export default async function AnalyticsImprovePage({ searchParams }: AnalyticsImprovePageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const timeZone = await workspaceTimeZone(workspaceId);
  const range = parseAnalyticsRange(toSearchParams(params), timeZone);
  // The loader already returns the workspace's AI agents (id, name) for the knowledge-base modal.
  const data = await loadImprovementAreas(workspaceId, range);

  return <AnalyticsImproveWorkspace data={data} canTrain={hasRole(session.user.role, "MANAGER")} />;
}
