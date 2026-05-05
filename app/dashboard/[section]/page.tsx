import { notFound } from "next/navigation";
import {
  dashboardPageMap,
  dashboardPageOrder,
} from "@/src/components/dashboard/dashboard-config";
import { DashboardPlaceholderPage } from "@/src/components/dashboard/dashboard-placeholder-page";

type DashboardSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

export default async function DashboardSectionPage({
  params,
}: DashboardSectionPageProps) {
  const { section } = await params;

  if (section === "tickets") {
    notFound();
  }

  if (!dashboardPageOrder.includes(section)) {
    notFound();
  }

  const page = dashboardPageMap[section];

  return (
    <DashboardPlaceholderPage
      title={page.title}
      description={page.description}
      moduleLabel={page.moduleLabel}
    />
  );
}
