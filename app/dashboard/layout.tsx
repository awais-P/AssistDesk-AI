import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="grid min-h-screen lg:grid-cols-[255px_1fr]">
        <DashboardSidebar
          user={{
            fullName: session.user.fullName,
            email: session.user.email,
          }}
        />
        <main className="min-w-0 bg-black">{children}</main>
      </div>
    </div>
  );
}
