import { redirect } from "next/navigation";
import { ToolsWorkspace } from "@/src/components/dashboard/tools/tools-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { hasRole } from "@/src/lib/rbac";

/** Module 2 FE-3: the actions AI agents can take (built-in and custom HTTP tools). */
export default async function ToolsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  if (!hasRole(session.user.role, "MANAGER")) {
    return (
      <div className="px-5 py-4 md:px-6">
        <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">Tools</h1>
        <p className="mt-4 max-w-xl rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          Tools decide what the AI may do for customers, so only managers and admins can see and
          change them. Ask a workspace admin if an action needs to change.
        </p>
      </div>
    );
  }

  return <ToolsWorkspace />;
}
