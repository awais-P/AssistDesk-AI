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
  "Knowledge Base": "KB",
  "Canned Responses": "T",
  Tags: "#",
  "API Keys": "K",
  Settings: "S",
  Integrations: "N",
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
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white text-xs font-semibold text-black">
            A
          </span>
          <div>
            <p className="text-sm font-semibold text-white">assistdesk.ai</p>
            <p className="text-[10px] text-slate-400">Support workspace</p>
          </div>
        </div>
        <div className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-slate-300">
          []
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-2 py-2">
        {groups.map((group) => (
          <div key={group}>
            <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {group}
            </p>

            <div className="mt-1 space-y-0.5">
              {dashboardItems
                .filter((item) => item.group === group)
                .map((item) => {
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.85rem] transition ${
                        isActive
                          ? "bg-[#2a2a2a] font-semibold text-white"
                          : "text-slate-300 hover:bg-[#1a1a1a]"
                      }`}
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-[9px] font-semibold text-slate-300">
                        {iconMap[item.title] ?? "*"}
                      </span>
                      <span className="truncate">{item.title}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-3 py-2">
        <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-slate-300">
          <span className="text-[10px] text-slate-400">*</span>
          <span className="font-medium">Light Mode</span>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-2.5 py-2">
          <Link
            href="/dashboard/profile"
            className="pressable flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-white/5"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#222222] text-xs font-semibold text-white">
              {user.fullName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">
                {user.fullName}
              </p>
              <p className="truncate text-[10px] text-slate-400">{user.email}</p>
            </div>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-lg border border-white/10 bg-[#111111] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
