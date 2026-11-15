"use client";

import { useCallback, useEffect, useState } from "react";
import { type PermissionDefinition, roleHas } from "@/src/lib/permissions";

type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  baseRole: "ADMIN" | "MANAGER" | "AGENT";
  permissions: string[];
  deniedPermissions: string[];
  _count: { users: number };
};
type Member = { id: string; fullName: string; email: string; role: string; customRoleId: string | null };
type RolesResponse = { permissions: PermissionDefinition[]; roles: CustomRole[]; members: Member[]; me: { id: string; role: string }; error?: string };

const BASE_ROLES = ["AGENT", "MANAGER", "ADMIN"] as const;
const roleLabel = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();
const inputClass = "w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-white outline-none transition focus:border-white";
const buttonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";
const primaryClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50";

type Draft = { id: string | null; name: string; description: string; baseRole: "ADMIN" | "MANAGER" | "AGENT"; granted: Set<string> };

function draftFrom(role: CustomRole | null, permissions: PermissionDefinition[]): Draft {
  const baseRole = role?.baseRole ?? "AGENT";
  const granted = new Set(
    permissions
      .filter((permission) => (roleHas(baseRole, permission.key) || role?.permissions.includes(permission.key)) && !role?.deniedPermissions.includes(permission.key))
      .map((permission) => permission.key),
  );
  return { id: role?.id ?? null, name: role?.name ?? "", description: role?.description ?? "", baseRole, granted };
}

export function RolesWorkspace({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<RolesResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/roles", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as RolesResponse;
    if (!response.ok) {
      setError(body.error ?? "Could not load the roles.");
      return;
    }
    setData(body);
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function send(url: string, init: RequestInit, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "That did not work.");
        return false;
      }
      setNotice(success);
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !data) return;
    // Store only the differences from the base role.
    const permissions = data.permissions.filter((permission) => draft.granted.has(permission.key) && !roleHas(draft.baseRole, permission.key)).map((permission) => permission.key);
    const deniedPermissions = data.permissions.filter((permission) => !draft.granted.has(permission.key) && roleHas(draft.baseRole, permission.key)).map((permission) => permission.key);
    const done = await send(
      draft.id ? `/api/roles/${draft.id}` : "/api/roles",
      { method: draft.id ? "PATCH" : "POST", body: JSON.stringify({ name: draft.name, description: draft.description, baseRole: draft.baseRole, permissions, deniedPermissions }) },
      draft.id ? `Role "${draft.name}" saved.` : `Role "${draft.name}" created. Give it to team members below.`,
    );
    if (done) setDraft(null);
  }

  if (!canManage) {
    return (
      <div className="px-5 py-4 md:px-6">
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Roles</h1>
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">Only workspace admins can manage roles.</p>
      </div>
    );
  }

  const permissions = data?.permissions ?? [];

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Roles</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            What each role may do. Create your own roles, such as &quot;Senior agent&quot; or &quot;Operator&quot;: start from a built-in level and add or remove
            permissions. Every change is in the audit log.
          </p>
        </div>
        <button type="button" className={primaryClass} disabled={!data} onClick={() => data && setDraft(draftFrom(null, data.permissions))}>
          Create role
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {draft ? (
        <form onSubmit={saveDraft} className="mt-6 max-w-4xl space-y-4 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-lg font-semibold text-white">{draft.id ? `Edit "${draft.name}"` : "New role"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-white">
              Name
              <input value={draft.name} maxLength={40} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Senior agent" className={`${inputClass} mt-1.5 font-normal`} />
            </label>
            <label className="block text-sm font-semibold text-white">
              Based on
              <select
                value={draft.baseRole}
                onChange={(event) => {
                  const baseRole = event.target.value as Draft["baseRole"];
                  setDraft({ ...draft, baseRole, granted: new Set(permissions.filter((permission) => roleHas(baseRole, permission.key)).map((permission) => permission.key)) });
                }}
                className={`${inputClass} mt-1.5 font-normal`}
              >
                {BASE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-sm font-semibold text-white">
            Description (optional)
            <input value={draft.description} maxLength={200} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className={`${inputClass} mt-1.5 font-normal`} />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-white">Permissions</legend>
            <p className="text-xs text-slate-500">Ticked by default: what the base level already has. Pages and actions outside this list follow the base level.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {permissions.map((permission) => {
                const fromBase = roleHas(draft.baseRole, permission.key);
                const checked = draft.granted.has(permission.key);
                const locked = draft.baseRole !== "ADMIN" && (permission.key === "roles.manage" || permission.key === "apikeys.manage" || permission.key === "billing.manage");
                return (
                  <label key={permission.key} className={`flex items-start gap-2.5 text-sm ${locked ? "text-slate-500" : "text-slate-200"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={(event) => {
                        const granted = new Set(draft.granted);
                        if (event.target.checked) granted.add(permission.key);
                        else granted.delete(permission.key);
                        setDraft({ ...draft, granted });
                      }}
                      className="mt-1"
                    />
                    <span>
                      {permission.label}
                      <span className="block text-xs text-slate-500">
                        {locked ? "Admins only" : checked === fromBase ? (fromBase ? `From ${roleLabel(draft.baseRole)}` : "Not included") : checked ? "Added" : "Removed"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex gap-2.5">
            <button type="submit" disabled={busy} className={primaryClass}>
              {draft.id ? "Save role" : "Create role"}
            </button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <section aria-labelledby="matrix-title" className="mt-6 overflow-x-auto rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        <h2 id="matrix-title" className="px-4 pt-4 font-semibold text-white">
          Permissions by role
        </h2>
        <table className="mt-2 w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-white">
              <th scope="col" className="px-4 py-3 font-semibold">Permission</th>
              {[...BASE_ROLES, "OWNER"].map((role) => (
                <th key={role} scope="col" className="px-3 py-3 text-center font-semibold">
                  {roleLabel(role)}
                </th>
              ))}
              {data?.roles.map((role) => (
                <th key={role.id} scope="col" className="px-3 py-3 text-center font-semibold text-sky-200">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission) => (
              <tr key={permission.key} className="border-b border-white/10 text-slate-200 last:border-b-0">
                <td className="px-4 py-2.5">
                  {permission.label}
                  <span className="block text-xs text-slate-500">{permission.description}</span>
                </td>
                {[...BASE_ROLES, "OWNER"].map((role) => (
                  <td key={role} className="px-3 py-2.5 text-center" aria-label={roleHas(role, permission.key) || role === "OWNER" ? "Yes" : "No"}>
                    {roleHas(role, permission.key) || role === "OWNER" ? "✓" : "·"}
                  </td>
                ))}
                {data?.roles.map((role) => {
                  const has = !role.deniedPermissions.includes(permission.key) && (role.permissions.includes(permission.key) || roleHas(role.baseRole, permission.key));
                  return (
                    <td key={role.id} className="px-3 py-2.5 text-center text-sky-200" aria-label={has ? "Yes" : "No"}>
                      {has ? "✓" : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="custom-title" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <h2 id="custom-title" className="font-semibold text-white">
            Custom roles
          </h2>
          {data && data.roles.length === 0 ? <p className="mt-2 text-sm text-slate-500">No custom roles yet.</p> : null}
          <ul className="mt-3 space-y-3">
            {data?.roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{role.name}</p>
                  <p className="text-xs text-slate-400">
                    Based on {roleLabel(role.baseRole)}
                    {role.permissions.length ? ` · adds ${role.permissions.length}` : ""}
                    {role.deniedPermissions.length ? ` · removes ${role.deniedPermissions.length}` : ""} · {role._count.users} member(s)
                  </p>
                  {role.description ? <p className="text-xs text-slate-500">{role.description}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => setDraft(draftFrom(role, permissions))}>
                    Edit
                  </button>
                  <button type="button" className={buttonClass} disabled={busy} onClick={() => void send(`/api/roles/${role.id}`, { method: "DELETE" }, `Role "${role.name}" deleted; its members keep the ${roleLabel(role.baseRole)} level.`)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="members-title" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <h2 id="members-title" className="font-semibold text-white">
            Who has which role
          </h2>
          <ul className="mt-3 divide-y divide-white/10">
            {data?.members.map((member) => {
              const locked = member.role === "OWNER" || member.id === data.me.id;
              return (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-white">{member.fullName}</p>
                    <p className="text-xs text-slate-500">{member.email}</p>
                  </div>
                  <label className="sr-only" htmlFor={`role-${member.id}`}>
                    Role of {member.fullName}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    disabled={locked || busy}
                    value={member.customRoleId ? `custom:${member.customRoleId}` : `base:${member.role}`}
                    onChange={(event) => {
                      const [kind, value] = event.target.value.split(":");
                      void send(
                        `/api/users/${member.id}`,
                        { method: "PATCH", body: JSON.stringify(kind === "custom" ? { customRoleId: value } : { role: value }) },
                        `${member.fullName}'s role was changed.`,
                      );
                    }}
                    className="h-9 rounded-lg border border-white/10 bg-[#111111] px-3 text-sm text-white outline-none focus:border-white disabled:opacity-60"
                  >
                    {member.role === "OWNER" ? <option value="base:OWNER">Owner</option> : null}
                    {BASE_ROLES.map((role) => (
                      <option key={role} value={`base:${role}`}>
                        {roleLabel(role)}
                      </option>
                    ))}
                    {data.roles.map((role) => (
                      <option key={role.id} value={`custom:${role.id}`}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
