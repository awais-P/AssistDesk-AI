"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { dashboardItems } from "./dashboard-config";

const groups = ["Main", "AI", "Setup", "Settings"];
const iconMap: Record<string, string> = {
  Tickets: "[]",
  Chats: "C",
  Reports: "R",
  Users: "U",
  "AI Agents": "A",
  Logs: "L",
  Inboxes: "I",
  Chatbots: "B",
  "Canned Responses": "T",
  Tags: "#",
  "API Keys": "K",
  Settings: "S",
  Profile: "P",
};

type DashboardSidebarProps = {
  user: {
    fullName: string;
    email: string;
  };
};

export function DashboardSidebar({ user }: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
    });

    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex min-h-screen flex-col border-r border-white/10 bg-[#111111]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
        <div>
          <p className="heading-font text-[1.25rem] font-bold text-white">
            AssistDesk
          </p>
        </div>
        <div className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300">
          []
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-2.5">
        {groups.map((group) => (
          <div key={group}>
            <p className="px-3 text-[0.8rem] font-semibold text-slate-400">
              {group}
            </p>

            <div className="mt-1.5 space-y-0.5">
              {dashboardItems
                .filter((item) => item.group === group)
                .map((item) => {
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.95rem] transition ${
                        isActive
                          ? "bg-[#2a2a2a] font-semibold text-white"
                          : "text-slate-300 hover:bg-[#1a1a1a]"
                      }`}
                    >
                      <span className="flex h-4 min-w-4 items-center justify-center text-[10px] font-semibold text-slate-300">
                        {iconMap[item.title] ?? "•"}
                      </span>
                      <span>{item.title}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-4 py-2.5">
        <div className="mb-2.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
          <p className="text-sm font-medium text-emerald-300">Lifetime</p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/80">
            Module 7 sidebar shell is active.
          </p>
        </div>

        <div className="mb-2.5 flex items-center gap-2 rounded-xl px-2 py-1 text-sm text-white">
          <span className="text-sm text-slate-300">*</span>
          <span className="font-medium">Light Mode</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5">
          <Link
            href="/dashboard/profile"
            className="pressable flex items-center gap-3 rounded-xl px-1 py-1 transition hover:bg-white/5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#222222] text-sm font-semibold text-white">
              {user.fullName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {user.fullName}
              </p>
              <p className="truncate text-xs text-slate-400">{user.email}</p>
            </div>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-2.5 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Log Out
          </button>
        </div>
      </div>
    </aside>
  );
}
