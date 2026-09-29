import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { DashboardSidebar } from "@/src/components/dashboard/dashboard-sidebar";
import { PresenceHeartbeat } from "@/src/components/dashboard/presence-heartbeat";

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
      <PresenceHeartbeat />
      <div className="grid min-h-screen grid-rows-[auto_1fr] lg:grid-cols-[255px_1fr] lg:grid-rows-none">
        <DashboardSidebar
          user={{
            fullName: session.user.fullName,
            email: session.user.email,
            role: session.user.role,
          }}
        />
        <main className="min-w-0 bg-black">
          {session.user.mustChangePassword ? (
            <div
              role="status"
              className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-sm text-amber-100 md:px-6"
            >
              You&apos;re using a temporary password.{" "}
              <Link
                href="/dashboard/profile?changePassword=1"
                className="font-semibold text-amber-50 underline underline-offset-2 hover:text-white"
              >
                Set your own password &rarr;
              </Link>
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
