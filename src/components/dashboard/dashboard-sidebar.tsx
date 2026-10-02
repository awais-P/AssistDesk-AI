"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { dashboardItems, isDashboardItemActive } from "./dashboard-config";
import { NotificationsBell } from "./notifications-bell";

const groups = ["Main", "AI", "Setup", "Settings"];
const DESKTOP_QUERY = "(min-width: 1024px)";

const iconPaths: Record<string, ReactNode> = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  tickets: (
    <>
      <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4Z" />
      <path d="M14 6v2M14 11v2M14 16v2" />
    </>
  ),
  chats: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z" />,
  contacts: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <circle cx="12" cy="10" r="2.75" />
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
    </>
  ),
  leads: (
    <>
      <path d="M4 5h16l-6 7.5V19l-4 1.5v-8Z" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 4v16h16" />
      <path d="m7.5 14.5 3.5-4 3 2.5 5-6" />
    </>
  ),
  reports: <path d="M4 20h16M6 20v-6M11 20V5M16 20v-9" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  "ai-agents": (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 13v1.5M15 13v1.5" />
    </>
  ),
  prompts: (
    <>
      <path d="M4 5h16v11H8l-4 4Z" />
      <path d="m8 9 2 2-2 2M12 13h4" />
    </>
  ),
  logs: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  inboxes: (
    <>
      <path d="M5 5h14l2 8v6H3v-6Z" />
      <path d="M3 13h5l1.5 3h5l1.5-3h5" />
    </>
  ),
  chatbots: (
    <>
      <path d="M4 4h16v12H9l-5 4Z" />
      <path d="M9 10h.01M15 10h.01" />
    </>
  ),
  "knowledge-base": (
    <>
      <path d="M5 18V6a2 2 0 0 1 2-2h12v14H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12" />
      <path d="M9 8h6" />
    </>
  ),
  "canned-responses": <path d="M13 3 5 14h6l-1 7 8-11h-6Z" />,
  tags: (
    <>
      <path d="M3.5 12V4.5H11l9.5 9.5-7 7Z" />
      <path d="M8 8h.01" />
    </>
  ),
  "api-keys": (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M16 7l3 3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  integrations: (
    <>
      <path d="M9 3v5M15 3v5M12 17v4" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0Z" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

function NavIcon({ section }: { section: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[section] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

function subscribeToDesktop(callback: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getDesktopSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getServerDesktopSnapshot() {
  return true;
}

function formatRole(role: string) {
  return `${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}

function getFocusable(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

type DashboardSidebarProps = {
  user: {
    fullName: string;
    email: string;
    role: string;
  };
};

export function DashboardSidebar({ user }: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isDesktop = useSyncExternalStore(
    subscribeToDesktop,
    getDesktopSnapshot,
    getServerDesktopSnapshot,
  );
  // The drawer remembers which page it was opened on, so navigating closes it.
  const [drawerOpenedOn, setDrawerOpenedOn] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isDrawerOpen = !isDesktop && drawerOpenedOn === pathname;

  function closeDrawer() {
    setDrawerOpenedOn(null);
    menuButtonRef.current?.focus();
  }

  // While the mobile drawer is open: lock page scroll, move focus inside, keep Tab
  // inside it and close on Escape.
  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const aside = asideRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (aside) {
      getFocusable(aside)[0]?.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpenedOn(null);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !aside) {
        return;
      }

      const focusable = getFocusable(aside);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!aside.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDrawerOpen]);

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const initials = user.fullName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/10 bg-[#111111]/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white text-xs font-semibold text-black">
            A
          </span>
          <span className="text-sm font-semibold text-white">assistdesk.ai</span>
        </Link>

        <div className="flex items-center gap-2">
          {!isDesktop ? <NotificationsBell align="right" /> : null}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpenedOn(pathname)}
            aria-label="Open navigation menu"
            aria-expanded={isDrawerOpen}
            aria-controls="dashboard-sidebar"
            className="pressable flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </header>

      {isDrawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      ) : null}

      <aside
        ref={asideRef}
        id="dashboard-sidebar"
        inert={!isDesktop && !isDrawerOpen}
        aria-label="Dashboard navigation"
        {...(isDrawerOpen ? { role: "dialog", "aria-modal": true } : {})}
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh w-[270px] max-w-[85vw] flex-col border-r border-white/10 bg-[#111111] transition-transform duration-200 lg:static lg:z-auto lg:h-auto lg:min-h-screen lg:w-auto lg:max-w-none lg:translate-none lg:transition-none ${
          isDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
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
          {isDesktop ? (
            <NotificationsBell />
          ) : (
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation menu"
              className="pressable flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-2">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {group}
              </p>

              <div className="mt-1 space-y-0.5">
                {dashboardItems
                  .filter((item) => item.group === group)
                  .map((item) => {
                    const isActive = isDashboardItemActive(item, pathname);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setDrawerOpenedOn(null)}
                        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.85rem] transition ${
                          isActive
                            ? "bg-[#2a2a2a] font-semibold text-white"
                            : "text-slate-300 hover:bg-[#1a1a1a]"
                        }`}
                      >
                        <span className={isActive ? "text-white" : "text-slate-400"}>
                          <NavIcon section={item.section} />
                        </span>
                        <span className="truncate">{item.title}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3 py-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/40 px-2.5 py-2">
            <Link
              href="/dashboard/profile"
              title={user.email}
              onClick={() => setDrawerOpenedOn(null)}
              className="pressable flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-white/5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#222222] text-xs font-semibold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {user.fullName}
                </p>
                <p className="truncate text-[10px] text-slate-400">
                  {formatRole(user.role)}
                </p>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
              className="shrink-0 rounded-lg border border-white/10 bg-[#111111] px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoggingOut ? "Logging out..." : "Log out"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
