"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { dashboardItems } from "./dashboard-config";

const groups = ["Main", "AI", "Setup", "Settings"];

export function DashboardSidebar() {
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
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-5">
        <div>
          <p className="heading-font text-[2rem] font-bold text-white">
            AssistDesk
          </p>
          <p className="text-xs text-slate-400">Dashboard Shell</p>
        </div>
        <div className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300">
          UI
        </div>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto px-2 py-5">
        {groups.map((group) => (
          <div key={group}>
            <p className="px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {group}
            </p>

            <div className="mt-3 space-y-1">
              {dashboardItems
                .filter((item) => item.group === group)
                .map((item) => {
                  const isActive = pathname === item.href;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${
                        isActive
                          ? "bg-[#2a2a2a] font-semibold text-white"
                          : "text-slate-300 hover:bg-[#1a1a1a]"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded border ${
                          isActive
                            ? "border-white bg-white/10"
                            : "border-white/20 bg-transparent"
                        }`}
                      />
                      <span>{item.title}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#222222] text-sm font-semibold text-white">
              MA
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                Muhammad Awais
              </p>
              <p className="truncate text-xs text-slate-400">
                admin@assistdesk.local
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Log Out
          </button>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4">
          <p className="text-sm font-medium text-emerald-300">Module 7 active</p>
          <p className="mt-1 text-xs leading-5 text-emerald-100/80">
            Sidebar navigation, section shell, and profile area are ready.
          </p>
        </div>
      </div>
    </aside>
  );
}
