"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { WorkspaceRole } from "@/src/lib/rbac";

type AssignableRole = Exclude<WorkspaceRole, "OWNER">;

type UserItem = {
  id: string;
  fullName: string;
  email: string;
  role: WorkspaceRole;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  /** Whether the signed-in user may change or remove this member (rbac canManageMember). */
  canManage: boolean;
  /** Roles the signed-in user may give this member, excluding the current one. */
  assignableRoles: WorkspaceRole[];
};

type UsersWorkspaceProps = {
  users: UserItem[];
  currentUserId: string;
  canManageTeam: boolean;
  invitableRoles: Array<{ value: WorkspaceRole; description: string }>;
  presenceWindowMs: number;
};

type InviteResult = {
  users: Array<{ id: string; email: string; temporaryPassword: string }>;
  skipped: string[];
};

type MenuState = {
  userId: string;
  top: number;
  left: number;
};

const MENU_WIDTH = 190;
const MAX_INVITES = 20;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const pageSizeOptions = [10, 20];

const roleLabels: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
};

const roleOrder: Record<WorkspaceRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  AGENT: 3,
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function parseEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function UsersWorkspace({
  users,
  currentUserId,
  canManageTeam,
  invitableRoles,
  presenceWindowMs,
}: UsersWorkspaceProps) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | WorkspaceRole>("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "deactivated">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeOptions[0]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingUserId, setPendingUserId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [emailBlock, setEmailBlock] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>(
    invitableRoles.find((option) => option.value === "AGENT")?.value ??
      invitableRoles[0]?.value ??
      "AGENT",
  );
  const [inviteError, setInviteError] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [copiedKey, setCopiedKey] = useState("");
  const [clock, setClock] = useState<{ now: number; timeZone: string } | null>(null);

  // Dates and presence are only rendered after mount, in the browser's time zone,
  // so the server and client markup always match.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tick = () => setClock({ now: Date.now(), timeZone });

    tick();
    const interval = window.setInterval(tick, 30 * 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    function closeMenu() {
      setMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu(null);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const formatters = useMemo(() => {
    if (!clock) {
      return null;
    }

    return {
      date: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: clock.timeZone,
      }),
      dateTime: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: clock.timeZone,
      }),
    };
  }, [clock]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return users
      .filter((user) => {
        if (roleFilter && user.role !== roleFilter) {
          return false;
        }

        if (statusFilter === "active" && !user.isActive) {
          return false;
        }

        if (statusFilter === "deactivated" && user.isActive) {
          return false;
        }

        return (
          !query ||
          user.fullName.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query)
        );
      })
      .sort(
        (first, second) =>
          roleOrder[first.role] - roleOrder[second.role] ||
          first.fullName.localeCompare(second.fullName),
      );
  }, [roleFilter, search, statusFilter, users]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstItem = filteredUsers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, filteredUsers.length);
  const menuUser = menu ? users.find((user) => user.id === menu.userId) ?? null : null;
  const selectedRoleDescription = invitableRoles.find(
    (option) => option.value === inviteRole,
  )?.description;

  function isOnline(user: UserItem) {
    if (!clock || !user.lastSeenAt || !user.isActive) {
      return false;
    }

    return clock.now - new Date(user.lastSeenAt).getTime() <= presenceWindowMs;
  }

  function formatLastSeen(user: UserItem) {
    const value = user.lastSeenAt ?? user.lastLoginAt;

    if (!value) {
      return "Never";
    }

    return formatters ? formatters.dateTime.format(new Date(value)) : "…";
  }

  function openMenu(userId: string, button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();

    setMenu((current) =>
      current?.userId === userId
        ? null
        : {
            userId,
            top: rect.bottom + 6,
            left: Math.max(8, rect.right - MENU_WIDTH),
          },
    );
  }

  function openInviteModal() {
    setEmailBlock("");
    setInviteError("");
    setError("");
    setSuccess("");
    setInviteOpen(true);
  }

  function closeInviteModal() {
    if (!isInviting) {
      setInviteOpen(false);
    }
  }

  async function handleInviteUsers() {
    const emails = parseEmails(emailBlock);

    if (emails.length === 0) {
      setInviteError("Enter at least one email address, one per line.");
      return;
    }

    const invalid = emails.find((email) => !EMAIL_PATTERN.test(email));

    if (invalid) {
      setInviteError(`"${invalid}" doesn't look like a valid email address. Fix it and try again.`);
      return;
    }

    if (emails.length > MAX_INVITES) {
      setInviteError(`You can invite up to ${MAX_INVITES} people at a time. Split the list and send it in batches.`);
      return;
    }

    setInviteError("");
    setIsInviting(true);

    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emails,
          role: inviteRole,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        users?: InviteResult["users"];
        skipped?: string[];
      };

      if (!response.ok || !data.users) {
        setInviteError(
          data.error ?? "We couldn't add these users right now. Check your connection and try again.",
        );
        return;
      }

      setInviteResult({ users: data.users, skipped: data.skipped ?? [] });
      setCopiedKey("");
      setEmailBlock("");
      setInviteOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setInviteError("Something went wrong while adding users. Check your connection and try again.");
    } finally {
      setIsInviting(false);
    }
  }

  async function updateUser(
    user: UserItem,
    values: { role?: AssignableRole; isActive?: boolean },
    successMessage: string,
  ) {
    setMenu(null);
    setError("");
    setSuccess("");
    setPendingUserId(user.id);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(values),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? `We couldn't update ${user.fullName}. Refresh the page and try again.`);
        return;
      }

      setSuccess(successMessage);
      startTransition(() => router.refresh());
    } catch {
      setError("Something went wrong while updating the user. Check your connection and try again.");
    } finally {
      setPendingUserId("");
    }
  }

  async function handleStatusToggle(user: UserItem) {
    if (
      user.isActive &&
      !window.confirm(
        `Deactivate ${user.fullName}? They will be signed out and can't sign in until reactivated.`,
      )
    ) {
      return;
    }

    await updateUser(
      user,
      { isActive: !user.isActive },
      user.isActive ? `${user.fullName} was deactivated.` : `${user.fullName} was reactivated.`,
    );
  }

  async function handleDeleteUser(user: UserItem) {
    setMenu(null);

    if (
      !window.confirm(
        `Delete ${user.fullName} (${user.email})? Their tickets become unassigned. This action cannot be undone.`,
      )
    ) {
      return;
    }

    setError("");
    setSuccess("");
    setPendingUserId(user.id);

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? `We couldn't delete ${user.fullName}. Refresh the page and try again.`);
        return;
      }

      setSuccess(`${user.fullName} was removed from the workspace.`);
      startTransition(() => router.refresh());
    } catch {
      setError("Something went wrong while deleting the user. Check your connection and try again.");
    } finally {
      setPendingUserId("");
    }
  }

  async function copyToClipboard(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch {
      setCopiedKey(`${key}:failed`);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Users
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            {canManageTeam
              ? "Manage your team members and their account permissions here."
              : "See who is on your team. Only admins can invite or change members."}
          </p>
        </div>

        {canManageTeam && invitableRoles.length > 0 ? (
          <button
            type="button"
            onClick={openInviteModal}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            + Add User
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="users-search" className="text-sm font-medium text-white">
            Search
          </label>
          <input
            id="users-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            className="h-11 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="users-role-filter" className="text-sm font-medium text-white">
            Role
          </label>
          <select
            id="users-role-filter"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value as "" | WorkspaceRole);
              setPage(1);
            }}
            className="h-11 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none"
          >
            <option value="">All roles</option>
            {(Object.keys(roleLabels) as WorkspaceRole[]).map((role) => (
              <option key={role} value={role}>
                {roleLabels[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="users-status-filter" className="text-sm font-medium text-white">
            Status
          </label>
          <select
            id="users-status-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as "" | "active" | "deactivated");
              setPage(1);
            }}
            className="h-11 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>
      </div>

      <div
        className={`mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a] transition ${
          isRefreshing ? "opacity-70" : ""
        }`}
        aria-busy={isRefreshing}
      >
        {pageUsers.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-xl text-slate-300">No users match these filters</p>
            <p className="mt-2 text-sm text-slate-500">
              Try a different name, email, role or status.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white">
                  <th scope="col" className="px-4 py-5 font-semibold">User</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Role</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Last seen</th>
                  <th scope="col" className="px-4 py-5 font-semibold">Created</th>
                  {canManageTeam ? (
                    <th scope="col" className="px-4 py-5 text-right font-semibold">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => {
                  const online = isOnline(user);
                  const hasActions = user.canManage;

                  return (
                    <tr key={user.id} className="border-b border-white/10 last:border-b-0">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-white">
                            {getInitials(user.fullName)}
                            {online ? (
                              <span
                                className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a0a0a] bg-emerald-400"
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-white">
                              {user.fullName}
                              {user.id === currentUserId ? (
                                <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>
                              ) : null}
                            </p>
                            <p className="mt-1 truncate text-slate-400">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-lg border border-white/10 bg-[#111111] px-3 py-1 text-white">
                          {roleLabels[user.role]}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-lg px-3 py-1 ${
                              user.isActive
                                ? "bg-white text-[#050505]"
                                : "border border-white/10 bg-[#111111] text-slate-300"
                            }`}
                          >
                            {user.isActive ? "Active" : "Deactivated"}
                          </span>
                          {user.mustChangePassword ? (
                            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-200">
                              Temporary password
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-white">
                        {online ? (
                          <span className="inline-flex items-center gap-2 text-emerald-300">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
                            Online
                          </span>
                        ) : (
                          formatLastSeen(user)
                        )}
                      </td>
                      <td className="px-4 py-4 text-white">
                        {formatters ? formatters.date.format(new Date(user.createdAt)) : "…"}
                      </td>
                      {canManageTeam ? (
                        <td className="px-4 py-4 text-right">
                          {hasActions ? (
                            <button
                              type="button"
                              aria-label={`Actions for ${user.fullName}`}
                              aria-haspopup="menu"
                              aria-expanded={menu?.userId === user.id}
                              disabled={pendingUserId === user.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                openMenu(user.id, event.currentTarget);
                              }}
                              className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                                <circle cx="12" cy="5" r="1.8" />
                                <circle cx="12" cy="12" r="1.8" />
                                <circle cx="12" cy="19" r="1.8" />
                              </svg>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-5 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Showing {firstItem} to {lastItem} of {filteredUsers.length} results
            </span>
            <label htmlFor="users-page-size" className="sr-only">
              Rows per page
            </label>
            <select
              id="users-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="h-9 rounded-lg border border-white/10 bg-[#111111] px-2 text-sm text-white outline-none"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} per page
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              ‹
            </button>
            <span className="px-2 text-slate-300">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-300 transition hover:bg-[#1a1a1a] disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {menu && menuUser ? (
        <div
          role="menu"
          aria-label={`Actions for ${menuUser.fullName}`}
          className="fixed z-40 rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
          style={{ top: menu.top, left: menu.left, width: MENU_WIDTH }}
          onClick={(event) => event.stopPropagation()}
        >
          {menuUser.assignableRoles.map((role) => (
            <button
              key={role}
              type="button"
              role="menuitem"
              onClick={() =>
                void updateUser(
                  menuUser,
                  { role: role as AssignableRole },
                  `${menuUser.fullName} is now ${role === "ADMIN" ? "an" : "a"} ${roleLabels[role]}.`,
                )
              }
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
            >
              Make {roleLabels[role]}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleStatusToggle(menuUser)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
          >
            {menuUser.isActive ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleDeleteUser(menuUser)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      ) : null}

      {canManageTeam ? (
        <div
          inert={!inviteOpen}
          className={`fixed inset-0 z-50 transition ${
            inviteOpen ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          <button
            type="button"
            aria-label="Close user modal"
            onClick={closeInviteModal}
            className={`absolute inset-0 bg-black/60 transition duration-300 ${
              inviteOpen ? "opacity-100" : "opacity-0"
            }`}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-users-title"
            className={`absolute left-1/2 top-1/2 max-h-[92vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
              inviteOpen ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="invite-users-title" className="text-[2rem] font-semibold text-white">
                Add User
              </h2>
              <button
                type="button"
                onClick={closeInviteModal}
                aria-label="Close"
                className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a]"
              >
                X
              </button>
            </div>

            <div className="mt-5">
              <label htmlFor="invite-emails" className="mb-2 block text-sm font-medium text-white">
                Email Addresses
              </label>
              <textarea
                id="invite-emails"
                value={emailBlock}
                onChange={(event) => setEmailBlock(event.target.value)}
                placeholder="Enter one email address per line"
                aria-describedby="invite-emails-help"
                className="min-h-[110px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
              />
              <p id="invite-emails-help" className="mt-2 text-sm text-slate-400">
                Enter up to {MAX_INVITES} email addresses, one per line. Each person gets a
                temporary password.
              </p>
            </div>

            <div className="mt-5">
              <label htmlFor="invite-role" className="mb-2 block text-sm font-medium text-white">
                Role *
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as WorkspaceRole)}
                aria-describedby="invite-role-help"
                className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
              >
                {invitableRoles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {roleLabels[option.value]} — {option.description}
                  </option>
                ))}
              </select>
              {selectedRoleDescription ? (
                <p id="invite-role-help" className="mt-2 text-sm text-slate-400">
                  {selectedRoleDescription}
                </p>
              ) : null}
            </div>

            {inviteError ? (
              <p
                role="alert"
                className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {inviteError}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeInviteModal}
                disabled={isInviting}
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isInviting}
                onClick={() => void handleInviteUsers()}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {isInviting ? "Adding..." : "Add Users"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {inviteResult ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/70" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-result-title"
            className="absolute left-1/2 top-1/2 max-h-[92vh] w-[min(92vw,620px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <h2 id="invite-result-title" className="text-2xl font-semibold text-white">
              {inviteResult.users.length} user(s) added
            </h2>
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Share these securely. They&apos;ll be asked to set their own password at
              first sign-in. This is the only time the passwords are shown.
            </p>

            <ul className="mt-5 space-y-3">
              {inviteResult.users.map((user) => (
                <li
                  key={user.id}
                  className="rounded-xl border border-white/10 bg-[#111111] px-4 py-3"
                >
                  <p className="break-all text-sm font-medium text-white">{user.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded-lg bg-black px-3 py-1.5 font-mono text-sm text-emerald-200">
                      {user.temporaryPassword}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        void copyToClipboard(
                          user.id,
                          `Email: ${user.email}\nTemporary password: ${user.temporaryPassword}`,
                        )
                      }
                      aria-label={`Copy sign-in details for ${user.email}`}
                      className="pressable inline-flex h-8 items-center justify-center rounded-lg border border-white/10 bg-[#1a1a1a] px-3 text-xs font-semibold text-white transition hover:bg-[#232323]"
                    >
                      {copiedKey === user.id
                        ? "Copied"
                        : copiedKey === `${user.id}:failed`
                          ? "Copy failed, select the text"
                          : "Copy"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {inviteResult.skipped.length > 0 ? (
              <div className="mt-5">
                <p className="text-sm font-medium text-white">
                  Skipped ({inviteResult.skipped.length}) — these emails already have an
                  AssistDesk account:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
                  {inviteResult.skipped.map((email) => (
                    <li key={email} className="break-all">
                      {email}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {inviteResult.users.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    void copyToClipboard(
                      "all",
                      inviteResult.users
                        .map((user) => `${user.email}\t${user.temporaryPassword}`)
                        .join("\n"),
                    )
                  }
                  className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
                >
                  {copiedKey === "all" ? "Copied all" : "Copy all"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setInviteResult(null);
                  setCopiedKey("");
                }}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
              >
                I&apos;ve saved them
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
