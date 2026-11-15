"use client";

import { useCallback, useEffect, useState } from "react";
import { API_RATE_LIMIT, API_SCOPES } from "@/src/lib/api-keys-public";
import { RelativeTime } from "./notifications-bell";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  usageCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { fullName: string } | null;
};

const inputClass = "w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-white outline-none transition focus:border-white";
const buttonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";
const primaryClass =
  "pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50";

function keyState(key: ApiKeyRow) {
  if (key.revokedAt) return { label: "Revoked", className: "border-white/10 bg-white/5 text-slate-400" };
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return { label: "Expired", className: "border-amber-500/30 bg-amber-500/10 text-amber-100" };
  return { label: "Active", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" };
}

export function ApiKeysWorkspace({ canManage, origin }: { canManage: boolean; origin: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["tickets:read", "tickets:write"]);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/api-keys", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { keys?: ApiKeyRow[]; error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not load the API keys.");
      return;
    }
    setKeys(body.keys ?? []);
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes, expiresInDays: expiry ? Number(expiry) : null }),
      });
      const body = (await response.json().catch(() => ({}))) as { key?: ApiKeyRow; secret?: string; error?: string };
      if (!response.ok || !body.secret || !body.key) {
        setError(body.error ?? "Could not create the key.");
        return;
      }
      setSecret({ name: body.key.name, value: body.secret });
      setCopied(false);
      setCreating(false);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not revoke the key.");
      }
      setConfirmRevoke(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const example = `curl ${origin}/api/v1/tickets \\
  -H "Authorization: Bearer ad_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"subject":"Order 1042 arrived damaged","message":"The kettle lid is cracked.","requester_email":"ali@example.com"}'`;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">API Keys</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Connect your own systems (CRM, help desk, store, scripts) to AssistDesk&apos;s REST API. Each key only gets the permissions you
            choose, is limited to {API_RATE_LIMIT.limit} requests a minute, and every change it makes is in the audit log.
          </p>
        </div>
        {canManage ? (
          <button type="button" className={primaryClass} onClick={() => setCreating(true)}>
            Create API key
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">Only workspace admins can see and manage API keys.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {secret ? (
        <section role="status" className="mt-6 rounded-[22px] border border-emerald-500/30 bg-emerald-500/10 p-5">
          <h2 className="font-semibold text-emerald-100">Your new key &quot;{secret.name}&quot;</h2>
          <p className="mt-1 text-sm text-emerald-200/80">Copy it now. For your security it is not shown again; if you lose it, revoke it and create a new one.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <code aria-label="New API key" className="block flex-1 break-all rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white">
              {secret.value}
            </code>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                void navigator.clipboard?.writeText(secret.value).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={buttonClass} onClick={() => setSecret(null)}>
              Done
            </button>
          </div>
        </section>
      ) : null}

      {creating ? (
        <form onSubmit={create} className="mt-6 max-w-3xl space-y-4 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <label className="block text-sm font-semibold text-white">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. HubSpot sync" className={`${inputClass} mt-1.5 font-normal`} />
          </label>
          <fieldset>
            <legend className="text-sm font-semibold text-white">Permissions</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {API_SCOPES.map((scope) => (
                <label key={scope.key} className="flex items-start gap-2.5 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope.key)}
                    onChange={(event) => setScopes((current) => (event.target.checked ? [...current, scope.key] : current.filter((item) => item !== scope.key)))}
                    className="mt-1"
                  />
                  <span>
                    {scope.label}
                    <span className="block text-xs text-slate-500">{scope.key}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold text-white">
            Expires
            <select value={expiry} onChange={(event) => setExpiry(event.target.value)} className={`${inputClass} mt-1.5 max-w-xs font-normal`}>
              <option value="">Never</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In 1 year</option>
            </select>
          </label>
          <div className="flex gap-2.5">
            <button type="submit" disabled={busy} className={primaryClass}>
              {busy ? "Creating..." : "Create key"}
            </button>
            <button type="button" className={buttonClass} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {canManage ? (
        <div className="mt-6 overflow-x-auto rounded-[22px] border border-white/10 bg-[#0a0a0a]">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-white">
                <th scope="col" className="px-4 py-4 font-semibold">Name</th>
                <th scope="col" className="px-4 py-4 font-semibold">Key</th>
                <th scope="col" className="px-4 py-4 font-semibold">Permissions</th>
                <th scope="col" className="px-4 py-4 font-semibold">Last used</th>
                <th scope="col" className="px-4 py-4 font-semibold">Status</th>
                <th scope="col" className="px-4 py-4 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys && keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No API keys yet. Create one to connect another system.
                  </td>
                </tr>
              ) : null}
              {keys?.map((key) => {
                const state = keyState(key);
                return (
                  <tr key={key.id} className="border-b border-white/10 text-slate-200 last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">{key.name}</p>
                      <p className="text-xs text-slate-500">
                        {key.createdBy ? `by ${key.createdBy.fullName}, ` : ""}
                        <RelativeTime value={key.createdAt} />
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{key.prefix}…</td>
                    <td className="max-w-[280px] px-4 py-3 text-xs text-slate-400">{key.scopes.join(", ")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                      {key.lastUsedAt ? <RelativeTime value={key.lastUsedAt} /> : "Never"}
                      <span className="block text-xs text-slate-500">{key.usageCount.toLocaleString("en-US")} requests</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium ${state.className}`}>{state.label}</span>
                      {key.expiresAt && !key.revokedAt ? <span className="block text-xs text-slate-500">until {key.expiresAt.slice(0, 10)}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {!key.revokedAt ? (
                        confirmRevoke === key.id ? (
                          <span className="inline-flex gap-2">
                            <button type="button" disabled={busy} className="pressable inline-flex h-9 items-center rounded-lg bg-red-600 px-3.5 text-sm font-semibold text-white hover:bg-red-500" onClick={() => void revoke(key.id)}>
                              Revoke now
                            </button>
                            <button type="button" className={buttonClass} onClick={() => setConfirmRevoke(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className={buttonClass} onClick={() => setConfirmRevoke(key.id)}>
                            Revoke
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <section className="mt-8 max-w-4xl rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
        <h2 className="font-semibold text-white">Using the API</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li>
            Base URL: <code className="text-slate-200">{origin}/api/v1</code> · description:{" "}
            <a href="/api/v1/openapi.json" className="text-slate-200 underline underline-offset-2" target="_blank" rel="noreferrer">
              openapi.json
            </a>
          </li>
          <li>Send the key as <code className="text-slate-200">Authorization: Bearer ad_live_…</code>. Never put it in a website&apos;s code.</li>
          <li>Endpoints: tickets (list, get, create), contacts (list, create/update), leads (list, create), conversations (list, get), escalations (list).</li>
          <li>Lists return <code className="text-slate-200">{"{ data, nextCursor }"}</code>; pass <code className="text-slate-200">?cursor=</code> for the next page.</li>
        </ul>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black p-4 text-xs text-slate-300">{example}</pre>
      </section>
    </div>
  );
}
