"use client";

import { useCallback, useEffect, useState } from "react";
import { RelativeTime } from "./notifications-bell";

type ConnectorState = {
  provider: "HUBSPOT" | "SHOPIFY";
  connected: boolean;
  name: string | null;
  status: string;
  shopDomain: string | null;
  autoSync: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  syncedCount: number;
};

type ConnectorsResponse = {
  hubspot: ConnectorState & { leadsInCrm: number; leadsNotSynced: number };
  shopify: ConnectorState;
  error?: string;
};

const inputClass = "w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-white outline-none transition focus:border-white";
const buttonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3.5 text-sm font-semibold text-white transition hover:bg-[#1a1a1a] disabled:opacity-50";
const primaryClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-50";

function StatusBadge({ state }: { state: ConnectorState }) {
  const tone = !state.connected
    ? "border-white/10 bg-white/5 text-slate-400"
    : state.status === "ERROR"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {!state.connected ? "Not connected" : state.status === "ERROR" ? "Needs attention" : "Connected"}
    </span>
  );
}

export function ConnectorsWorkspace({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<ConnectorsResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hubspotToken, setHubspotToken] = useState("");
  const [shopDomain, setShopDomain] = useState("");
  const [shopToken, setShopToken] = useState("");
  const [lookup, setLookup] = useState({ orderNumber: "", email: "" });
  const [lookupResult, setLookupResult] = useState<string>("");

  const load = useCallback(async () => {
    const response = await fetch("/api/connectors", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as ConnectorsResponse;
    if (!response.ok) {
      setError(body.error ?? "Could not load the connectors.");
      return;
    }
    setData(body);
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  async function send(key: string, url: string, init: RequestInit, success: (body: Record<string, unknown>) => string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        setError(body.error ?? "That did not work.");
        return null;
      }
      setNotice(success(body));
      await load();
      return body;
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <div className="px-5 py-4 md:px-6">
        <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Connectors</h1>
        <p className="mt-6 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">Only workspace admins can manage connectors.</p>
      </div>
    );
  }

  const hubspot = data?.hubspot;
  const shopify = data?.shopify;

  return (
    <div className="px-5 py-4 md:px-6">
      <h1 className="heading-font text-[2rem] font-bold leading-none text-white">Connectors</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-400">
        Connect your CRM and online store. Leads go to HubSpot automatically, and the AI can answer &quot;where is my order?&quot; from Shopify.
        Tokens are stored encrypted and never shown again. For anything else, use the API keys and webhooks.
      </p>

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

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="hubspot-title" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="hubspot-title" className="text-lg font-semibold text-white">
              HubSpot <span className="text-sm font-normal text-slate-400">· CRM</span>
            </h2>
            {hubspot ? <StatusBadge state={hubspot} /> : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">Every lead (name, email, phone, company, status) becomes or updates a HubSpot contact.</p>

          {hubspot?.connected ? (
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                {hubspot.leadsInCrm} lead(s) in HubSpot · {hubspot.leadsNotSynced} not synced yet
                {hubspot.lastSyncedAt ? (
                  <>
                    {" "}
                    · last sync <RelativeTime value={hubspot.lastSyncedAt} />
                  </>
                ) : null}
              </p>
              {hubspot.lastError ? <p className="text-red-300">Last error: {hubspot.lastError}</p> : null}
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  role="switch"
                  checked={hubspot.autoSync}
                  disabled={busy !== null}
                  onChange={(event) =>
                    void send("hubspot-auto", "/api/connectors/hubspot", { method: "POST", body: JSON.stringify({ action: "settings", autoSync: event.target.checked }) }, () =>
                      event.target.checked ? "New and changed leads go to HubSpot automatically." : "Automatic sync is off; use Sync now.",
                    )
                  }
                />
                Sync new and changed leads automatically
              </label>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className={primaryClass}
                  disabled={busy !== null}
                  onClick={() => void send("hubspot-sync", "/api/connectors/hubspot", { method: "POST", body: JSON.stringify({ action: "sync" }) }, (body) => `${String(body.synced)} lead(s) sent to HubSpot.`)}
                >
                  {busy === "hubspot-sync" ? "Syncing..." : "Sync now"}
                </button>
                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void send("hubspot-off", "/api/connectors/hubspot", { method: "DELETE" }, () => "HubSpot disconnected; the token was deleted.")}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send("hubspot", "/api/connectors", { method: "POST", body: JSON.stringify({ provider: "HUBSPOT", token: hubspotToken }) }, () => "HubSpot connected. New leads will appear there.").then((done) => {
                  if (done) setHubspotToken("");
                });
              }}
            >
              <label className="block text-sm font-semibold text-white">
                Private app access token
                <input type="password" autoComplete="off" value={hubspotToken} onChange={(event) => setHubspotToken(event.target.value)} placeholder="pat-na1-…" className={`${inputClass} mt-1.5 font-normal`} />
              </label>
              <p className="text-xs text-slate-500">HubSpot → Settings → Integrations → Private apps → Create, with the scopes crm.objects.contacts.read and .write.</p>
              <button type="submit" className={primaryClass} disabled={busy !== null || !hubspotToken.trim()}>
                {busy === "hubspot" ? "Checking..." : "Connect HubSpot"}
              </button>
            </form>
          )}
        </section>

        <section aria-labelledby="shopify-title" className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="shopify-title" className="text-lg font-semibold text-white">
              Shopify <span className="text-sm font-normal text-slate-400">· online store</span>
            </h2>
            {shopify ? <StatusBadge state={shopify} /> : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Adds the AI action &quot;Shopify order status&quot;: order status, items and tracking, shown only when the customer&apos;s email or phone matches the order.
          </p>

          {shopify?.connected ? (
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <p>
                Store: <span className="text-white">{shopify.name}</span> ({shopify.shopDomain})
              </p>
              {shopify.lastError ? <p className="text-red-300">Last error: {shopify.lastError}</p> : null}
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send("shopify-lookup", "/api/connectors/shopify", { method: "POST", body: JSON.stringify({ action: "lookup", ...lookup }) }, (body) => {
                    const result = body.result as { found: boolean; order?: string; status?: string; tracking?: unknown[] };
                    setLookupResult(JSON.stringify(result, null, 2));
                    return result.found ? `Order ${result.order}: ${result.status}.` : "No matching order (number and email must both match).";
                  });
                }}
              >
                <label className="text-xs text-slate-400">
                  Order number
                  <input value={lookup.orderNumber} onChange={(event) => setLookup({ ...lookup, orderNumber: event.target.value })} placeholder="1042" className={`${inputClass} mt-1 w-28`} />
                </label>
                <label className="text-xs text-slate-400">
                  Customer email
                  <input value={lookup.email} onChange={(event) => setLookup({ ...lookup, email: event.target.value })} placeholder="customer@example.com" className={`${inputClass} mt-1 w-56`} />
                </label>
                <button type="submit" className={buttonClass} disabled={busy !== null || !lookup.orderNumber.trim()}>
                  Try a lookup
                </button>
              </form>
              {lookupResult ? <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black p-3 text-xs text-slate-400">{lookupResult}</pre> : null}
              <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void send("shopify-off", "/api/connectors/shopify", { method: "DELETE" }, () => "Shopify disconnected; the token was deleted.")}>
                Disconnect
              </button>
            </div>
          ) : (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send("shopify", "/api/connectors", { method: "POST", body: JSON.stringify({ provider: "SHOPIFY", shopDomain, token: shopToken }) }, () => "Shopify connected. Your AI agents can now look up orders.").then((done) => {
                  if (done) setShopToken("");
                });
              }}
            >
              <label className="block text-sm font-semibold text-white">
                Store address
                <input value={shopDomain} onChange={(event) => setShopDomain(event.target.value)} placeholder="kettle-store.myshopify.com" className={`${inputClass} mt-1.5 font-normal`} />
              </label>
              <label className="block text-sm font-semibold text-white">
                Admin API access token
                <input type="password" autoComplete="off" value={shopToken} onChange={(event) => setShopToken(event.target.value)} placeholder="shpat_…" className={`${inputClass} mt-1.5 font-normal`} />
              </label>
              <p className="text-xs text-slate-500">Shopify admin → Settings → Apps → Develop apps → Create an app with the read_orders scope → Install.</p>
              <button type="submit" className={primaryClass} disabled={busy !== null || !shopToken.trim() || !shopDomain.trim()}>
                {busy === "shopify" ? "Checking..." : "Connect Shopify"}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
