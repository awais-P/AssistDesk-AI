"use client";

import { useEffect, useMemo, useState } from "react";

type UserItem = {
  id: string;
  fullName: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type UsersWorkspaceProps = {
  initialUsers: UserItem[];
  currentUserId: string;
};

const roleOptions = [
  { label: "Staff", value: "AGENT" as const },
  { label: "Manager", value: "MANAGER" as const },
  { label: "Admin", value: "ADMIN" as const },
];

function formatDate(value: string | null, includeTime = false) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "numeric",
          minute: "2-digit",
        }
      : {}),
  }).format(new Date(value));
}

function formatRole(role: UserItem["role"]) {
  if (role === "OWNER") {
    return "Owner";
  }

  if (role === "ADMIN") {
    return "Admin";
  }

  if (role === "MANAGER") {
    return "Manager";
  }

  return "Staff";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UsersWorkspace({
  initialUsers,
  currentUserId,
}: UsersWorkspaceProps) {
  const [users, setUsers] = useState(initialUsers);
  const [menuOpenId, setMenuOpenId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [emailBlock, setEmailBlock] = useState("");
  const [role, setRole] = useState<(typeof roleOptions)[number]["value"]>("AGENT");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    function handleWindowClick() {
      setMenuOpenId("");
    }

    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  const sortedUsers = useMemo(() => {
    return [...users].sort((first, second) => {
      if (first.role === "OWNER" && second.role !== "OWNER") {
        return -1;
      }

      if (first.role !== "OWNER" && second.role === "OWNER") {
        return 1;
      }

      return first.fullName.localeCompare(second.fullName);
    });
  }, [users]);

  async function handleInviteUsers() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const emails = emailBlock
        .split("\n")
        .map((email) => email.trim())
        .filter(Boolean);

      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emails,
          role,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        users?: UserItem[];
      };

      if (!response.ok || !data.users) {
        setError(data.error ?? "Unable to add users right now.");
        setIsSaving(false);
        return;
      }

      const createdUsers = data.users;

      setUsers((current) => [
        ...current,
        ...createdUsers.map((user) => ({
          ...user,
          createdAt: new Date(user.createdAt).toISOString(),
          lastLoginAt: null,
        })),
      ]);
      setSuccess("User invitations created successfully.");
      setEmailBlock("");
      setRole("AGENT");
      setModalOpen(false);
    } catch {
      setError("Something went wrong while creating users.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateUser(userId: string, values: Partial<UserItem>) {
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(values),
    });

    const data = (await response.json()) as {
      error?: string;
      user?: UserItem;
    };

    if (!response.ok || !data.user) {
      throw new Error(data.error ?? "Unable to update user.");
    }

    const updatedUser = data.user;

    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              role: updatedUser.role,
              isActive: updatedUser.isActive,
            }
          : user,
      ),
    );
  }

  async function handleRoleToggle(user: UserItem) {
    try {
      await updateUser(user.id, {
        role: user.role === "ADMIN" ? "AGENT" : "ADMIN",
      });
      setSuccess("User role updated successfully.");
      setMenuOpenId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to update user.");
    }
  }

  async function handleStatusToggle(user: UserItem) {
    try {
      await updateUser(user.id, {
        isActive: !user.isActive,
      });
      setSuccess("User status updated successfully.");
      setMenuOpenId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to update user.");
    }
  }

  async function handleDeleteUser(userId: string) {
    const shouldDelete = window.confirm(
      "Delete this user? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    const response = await fetch(`/api/users/${userId}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(data.error ?? "Unable to delete user.");
      return;
    }

    setUsers((current) => current.filter((user) => user.id !== userId));
    setMenuOpenId("");
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Users
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Manage your team members and their account permissions here.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          + Add User
        </button>
      </div>

      {error ? (
        <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </p>
      ) : null}

      <div className="mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        <div className="grid grid-cols-[2.2fr_0.7fr_0.7fr_1fr_0.9fr_0.4fr] gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
          <span>User</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last Login</span>
          <span>Created</span>
          <span className="text-right">Actions</span>
        </div>

        {sortedUsers.map((user) => (
          <div
            key={user.id}
            className="grid grid-cols-[2.2fr_0.7fr_0.7fr_1fr_0.9fr_0.4fr] gap-4 border-b border-white/10 px-4 py-5 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/8 text-sm font-semibold text-white">
                {getInitials(user.fullName)}
              </div>
              <div>
                <p className="font-semibold text-white">{user.fullName}</p>
                <p className="mt-1 text-sm text-slate-400">{user.email}</p>
              </div>
            </div>

            <div className="flex items-center">
              <span className="rounded-lg border border-white/10 bg-[#111111] px-3 py-1 text-sm text-white">
                {formatRole(user.role)}
              </span>
            </div>

            <div className="flex items-center">
              <span
                className={`rounded-lg px-3 py-1 text-sm ${
                  user.isActive
                    ? "bg-white text-[#050505]"
                    : "border border-white/10 bg-[#111111] text-slate-300"
                }`}
              >
                {user.isActive ? "active" : "inactive"}
              </span>
            </div>

            <div className="flex items-center text-sm text-white">
              {formatDate(user.lastLoginAt, true)}
            </div>

            <div className="flex items-center text-sm text-white">
              {formatDate(user.createdAt)}
            </div>

            <div className="relative flex items-center justify-end">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpenId((current) => (current === user.id ? "" : user.id));
                }}
                className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-white transition hover:bg-[#1a1a1a]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <circle cx="12" cy="5" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="12" cy="19" r="1.8" />
                </svg>
              </button>

              {menuOpenId === user.id ? (
                <div
                  className="absolute right-0 top-11 z-20 min-w-[170px] rounded-xl border border-white/10 bg-[#0f0f0f] p-1.5 shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  {user.role !== "ADMIN" ? (
                    <button
                      type="button"
                      onClick={() => void handleRoleToggle(user)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                    >
                      Make Admin
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleRoleToggle(user)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                    >
                      Make Staff
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleStatusToggle(user)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                  >
                    {user.isActive ? "Deactivate" : "Activate"}
                  </button>
                  {user.id !== currentUserId ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteUser(user.id)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between px-4 py-5 text-sm text-slate-400">
          <span>
            Showing 1 to {sortedUsers.length} of {sortedUsers.length} results
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-400"
            >
              ‹
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-semibold text-[#050505]"
            >
              1
            </button>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-slate-400"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-50 transition ${
          modalOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close user modal"
          onClick={() => setModalOpen(false)}
          className={`absolute inset-0 bg-black/60 transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        <div
          className={`absolute left-1/2 top-1/2 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-white/10 bg-[#080808] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 ${
            modalOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[2rem] font-semibold text-white">Add User</h2>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="pressable rounded-lg border border-white/10 bg-[#111111] px-3 py-2 text-sm text-slate-300 transition hover:bg-[#1a1a1a]"
            >
              X
            </button>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-white">
              Email Addresses
            </label>
            <textarea
              value={emailBlock}
              onChange={(event) => setEmailBlock(event.target.value)}
              placeholder="Enter one email address per line"
              className="min-h-[110px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
            />
            <p className="mt-2 text-sm text-slate-400">
              Enter multiple email addresses, one per line
            </p>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-white">
              Role *
            </label>
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as (typeof roleOptions)[number]["value"])
              }
              className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleInviteUsers()}
              className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
            >
              {isSaving ? "Sending..." : "Send Invites"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
