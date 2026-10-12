import { redirect } from "next/navigation";
import {
  LeadsWorkspace,
  type LeadListState,
} from "@/src/components/dashboard/leads-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { loadLeadList, parseLeadFilters } from "@/src/lib/lead-list";
import { prisma } from "@/src/lib/prisma";
import { hasRole } from "@/src/lib/rbac";

type LeadsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZES = new Set([25, 50, 100]);

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

function toDateInput(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const filters = parseLeadFilters(toSearchParams(params));

  // The page offers 25 / 50 / 100 rows; anything else falls back to the default.
  if (!PAGE_SIZES.has(filters.pageSize)) {
    filters.pageSize = 25;
  }

  const [initialList, users] = await Promise.all([
    loadLeadList(workspaceId, filters, session.user.id),
    prisma.user.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  // A shared link can point past the last page once leads were deleted.
  let list = initialList;

  if (list.leads.length === 0 && filters.page > list.pageCount) {
    filters.page = list.pageCount;
    list = await loadLeadList(workspaceId, filters, session.user.id);
  }

  const initialState: LeadListState = {
    q: filters.query ?? "",
    status: filters.status ?? "",
    source: filters.source ?? "",
    channel: filters.channel ?? "",
    temperature: filters.temperature ?? "",
    owner: filters.owner ?? "",
    from: toDateInput(filters.from),
    to: toDateInput(filters.to),
    sort: filters.sort,
    order: filters.order,
    page: list.page,
    pageSize: list.pageSize,
  };

  return (
    <LeadsWorkspace
      initialState={initialState}
      initialList={list}
      users={users}
      currentUserId={session.user.id}
      canExport={hasRole(session.user.role, "MANAGER")}
    />
  );
}
