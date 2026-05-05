import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const session = cookieStore.get("assistdesk_session");

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="grid min-h-screen lg:grid-cols-[255px_1fr]">
        <DashboardSidebar />
        <main className="min-w-0 bg-black">{children}</main>
      </div>
    </div>
  );
}
