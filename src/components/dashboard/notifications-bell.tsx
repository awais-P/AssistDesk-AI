"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

export type NotificationSeverity = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

export type DashboardNotification = {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
};

type NotificationsResponse = {
  unreadCount: number;
  notifications: DashboardNotification[];
};

const POLL_INTERVAL_MS = 30 * 1000;
const NOW_TICK_MS = 30 * 1000;

export const severityDotClass: Record<NotificationSeverity, string> = {
  INFO: "bg-sky-400",
  SUCCESS: "bg-emerald-400",
  WARNING: "bg-amber-400",
  ERROR: "bg-red-400",
};

export const severityLabel: Record<NotificationSeverity, string> = {
  INFO: "Info",
  SUCCESS: "Success",
  WARNING: "Warning",
  ERROR: "Error",
};

/** Only follow links that stay inside the app. */
export function isInternalLink(link: string | null): link is string {
  return Boolean(link && link.startsWith("/") && !link.startsWith("//"));
}

function subscribeToNow(callback: () => void) {
  const interval = window.setInterval(callback, NOW_TICK_MS);
  return () => window.clearInterval(interval);
}

function getNowSnapshot() {
  return Math.floor(Date.now() / NOW_TICK_MS) * NOW_TICK_MS;
}

function getServerNowSnapshot() {
  return null;
}

/** Current time on the client only (null during SSR/hydration), ticking every 30s. */
function useNow() {
  return useSyncExternalStore(subscribeToNow, getNowSnapshot, getServerNowSnapshot);
}

export function formatRelativeTime(value: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 30) {
    return `${days}d ago`;
  }

  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Relative time rendered after mount so server and client markup always match. */
export function RelativeTime({ value, className }: { value: string; className?: string }) {
  const now = useNow();

  return (
    <time dateTime={value} className={className}>
      {now === null ? "" : formatRelativeTime(value, now)}
    </time>
  );
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

type NotificationsBellProps = {
  /** Which edge of the bell the dropdown lines up with. */
  align?: "left" | "right";
};

export function NotificationsBell({ align = "left" }: NotificationsBellProps) {
  const router = useRouter();
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });

      if (!mountedRef.current) {
        return;
      }

      if (!response.ok) {
        setLoadError("Couldn't load notifications. We'll try again in a moment.");
        return;
      }

      const next = (await response.json()) as NotificationsResponse;

      if (mountedRef.current) {
        setData(next);
        setLoadError("");
      }
    } catch {
      if (mountedRef.current) {
        setLoadError("Couldn't reach the server. Check your connection; we'll retry shortly.");
      }
    }
  }, []);

  // Poll while the tab is visible, and catch up as soon as it becomes visible again.
  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  // Escape and click-outside close the panel.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  function togglePanel() {
    if (!isOpen) {
      void refresh();
    }

    setIsOpen(!isOpen);
  }

  function markRead(ids: string[] | "all") {
    setData((current) => {
      if (!current) {
        return current;
      }

      const notifications = current.notifications.map((notification) =>
        ids === "all" || ids.includes(notification.id)
          ? { ...notification, read: true }
          : notification,
      );
      const newlyRead = current.notifications.filter(
        (notification) => !notification.read && (ids === "all" || ids.includes(notification.id)),
      ).length;

      return {
        notifications,
        unreadCount: ids === "all" ? 0 : Math.max(0, current.unreadCount - newlyRead),
      };
    });

    return fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // keepalive lets the request finish even if we navigate away right after.
      keepalive: true,
      body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
    });
  }

  function handleOpenNotification(notification: DashboardNotification) {
    if (!notification.read) {
      void markRead([notification.id]).catch(() => {
        // The next poll re-syncs the unread state if this failed.
      });
    }

    if (isInternalLink(notification.link)) {
      setIsOpen(false);
      router.push(notification.link);
    }
  }

  async function handleMarkAllRead() {
    setIsMarkingAll(true);

    try {
      const response = await markRead("all");

      if (!response.ok) {
        setLoadError("Couldn't mark notifications as read. Please try again.");
        void refresh();
      }
    } catch {
      setLoadError("Couldn't reach the server. Check your connection and try again.");
      void refresh();
    } finally {
      setIsMarkingAll(false);
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePanel}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
        }
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="pressable relative flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={`absolute top-full z-[60] mt-2 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-white/10 bg-[#111111] shadow-[0_20px_60px_rgba(0,0,0,0.6)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="text-[11px] text-slate-400">
                {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={isMarkingAll || unreadCount === 0}
              className="pressable rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMarkingAll ? "Marking..." : "Mark all as read"}
            </button>
          </div>

          {loadError ? (
            <p className="border-b border-white/10 bg-red-500/10 px-4 py-2 text-xs text-red-200">
              {loadError}
            </p>
          ) : null}

          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {data === null && !loadError ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Loading...</p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-white">No notifications yet</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  New chats, tickets, knowledge-base failures and integration problems
                  will show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenNotification(notification)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/5 ${
                        notification.read ? "" : "bg-white/[0.03]"
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDotClass[notification.severity]}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="sr-only">
                          {severityLabel[notification.severity]}
                          {notification.read ? "" : ", unread"}:{" "}
                        </span>
                        <span
                          className={`block text-sm ${
                            notification.read ? "text-slate-300" : "font-semibold text-white"
                          }`}
                        >
                          {notification.title}
                        </span>
                        {notification.body ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-400">
                            {notification.body}
                          </span>
                        ) : null}
                        <RelativeTime
                          value={notification.createdAt}
                          className="mt-1 block text-[11px] text-slate-500"
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
