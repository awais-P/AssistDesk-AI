import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AnalyticsOverviewWorkspace } from "@/src/components/dashboard/analytics-overview-workspace";
import { loadAnalyticsDashboard, parseAnalyticsRange, workspaceTimeZone } from "@/src/lib/analytics";
import { getCurrentSession } from "@/src/lib/auth";
import { can } from "@/src/lib/permissions";
import AnalyticsLoading from "./loading";

type AnalyticsPageProps = {
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

async function AsyncAnalyticsContent({
  workspaceId,
  params,
  canExport,
}: {
  workspaceId: string;
  params: Record<string, string | string[] | undefined>;
  canExport: boolean;
}) {
  const range = parseAnalyticsRange(toSearchParams(params), await workspaceTimeZone(workspaceId));
  const data = await loadAnalyticsDashboard(workspaceId, range);

  return <AnalyticsOverviewWorkspace data={data} canExport={canExport} />;
}

/** Module 4 analytics overview (SRS FE-3, mock-up M-11, FR-11.1–11.7). */
export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  return (
    <Suspense fallback={<AnalyticsLoading />}>
      <AsyncAnalyticsContent
        workspaceId={session.user.workspaceId}
        params={params}
        canExport={can(session.user, "data.export")}
      />
    </Suspense>
  );
}
