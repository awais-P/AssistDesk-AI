"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Card,
  type Notice,
  NoticeBox,
  Spinner,
  dangerButtonClass,
  formatDateTime,
  inputClass,
  primaryButtonClass,
  readJson,
  secondaryButtonClass,
  textareaClass,
} from "./tool-ui";

/**
 * Module 2 FE-1 refunds: the AI collects refund requests in chat (request_refund);
 * a manager approves or declines them here. Approving a Shopify order refunds it in
 * the store; without a store the team pays it out. The customer is told either way.
 */

type View = "pending" | "decided" | "all";
type Status = "PENDING" | "REFUNDED" | "APPROVED" | "DECLINED" | "FAILED";

type RefundRequest = {
  id: string;
  orderNumber: string;
  source: "SHOPIFY" | "SAMPLE" | "MANUAL";
  amount: number | null;
  currency: string | null;
  reason: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: Status;
  sessionId: string | null;
  contactId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  error: string | null;
  createdAt: string;
};

type ListResponse = {
  requests: RefundRequest[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
  refundWindowDays: number;
  shopifyConnected: boolean;
  canDecide: boolean;
  canEditSettings: boolean;
};

const views: Array<{ key: View; label: string }> = [
  { key: "pending", label: "Waiting" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All" },
];

const sourceLabel: Record<RefundRequest["source"], string> = {
  SHOPIFY: "Shopify order",
  SAMPLE: "Sample store",
  MANUAL: "Not checked against a store",
};

function money(amount: number | null, currency: string | null) {
  if (amount === null) return "Amount unknown";
  return `${currency ?? ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim();
}

function statusBadge(status: Status) {
  switch (status) {
    case "PENDING":
      return <Badge tone="warn">Waiting for approval</Badge>;
    case "REFUNDED":
      return <Badge tone="ok">Refunded</Badge>;
    case "APPROVED":
      return <Badge tone="ok">Approved, pay out manually</Badge>;
    case "DECLINED":
      return <Badge tone="neutral">Declined</Badge>;
    case "FAILED":
      return <Badge tone="error">Store refund failed</Badge>;
  }
}

const deliveredText: Record<string, string> = {
  conversation: "The customer was told in the conversation.",
  email: "The customer was told by email.",
  "not delivered": "The customer could not be told automatically; let them know.",
  "not sent": "",
};

function RefundRow({ request, canDecide, onChanged }: { request: RefundRequest; canDecide: boolean; onChanged: (notice: Notice) => void }) {
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const open = request.status === "PENDING" || request.status === "FAILED";

  async function decide(decision: "approve" | "decline") {
    setBusy(true);
    setNotice(null);
    const response = await fetch(`/api/refund-requests/${encodeURIComponent(request.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note: note.trim() || null }),
    });
    const body = await readJson<{ status: Status; error: string | null; delivered: string }>(response);
    setBusy(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save the decision." });
      return;
    }

    if (body.status === "FAILED") {
      setNotice({ tone: "error", text: `The store did not refund the order: ${body.error ?? "unknown error"}. Fix it in Shopify and try again, or decline.` });
      onChanged(null);
      return;
    }

    setMode(null);
    const done =
      body.status === "REFUNDED"
        ? `Order #${request.orderNumber} was refunded in Shopify.`
        : body.status === "APPROVED"
          ? `Refund for order #${request.orderNumber} approved. Pay it out to the customer.`
          : `Refund for order #${request.orderNumber} declined.`;
    onChanged({ tone: "success", text: `${done} ${deliveredText[body.delivered] ?? ""}`.trim() });
  }

  const person = request.customerName || request.customerEmail || request.customerPhone || "Unknown customer";

  return (
    <li className="rounded-xl border border-white/10 bg-[#0d0d0d] p-4" aria-label={`Refund for order ${request.orderNumber}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">
              Order #{request.orderNumber} · {money(request.amount, request.currency)}
            </p>
            {statusBadge(request.status)}
            <Badge tone={request.source === "SHOPIFY" ? "info" : "neutral"}>{sourceLabel[request.source]}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {request.contactId ? (
              <Link href={`/dashboard/contacts/${request.contactId}`} className="text-slate-300 underline-offset-2 hover:underline">
                {person}
              </Link>
            ) : (
              person
            )}
            {[request.customerEmail, request.customerPhone].filter((value) => value && value !== person).map((value) => ` · ${value}`)}
            {" · "}requested {formatDateTime(request.createdAt)}
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
            <span className="text-xs text-slate-500">Reason: </span>
            {request.reason}
          </p>
          {request.decidedAt && request.status !== "PENDING" ? (
            <p className="mt-2 text-xs text-slate-400">
              {request.status === "DECLINED" ? "Declined" : request.status === "FAILED" ? "Tried" : "Approved"} by {request.decidedByName ?? "a team member"} on {formatDateTime(request.decidedAt)}
              {request.decisionNote ? `: “${request.decisionNote}”` : ""}
            </p>
          ) : null}
          {request.status === "FAILED" && request.error ? <p className="mt-1 text-xs text-red-300">Shopify said: {request.error}</p> : null}
          {request.sessionId ? (
            <Link href={`/dashboard/chats?session=${encodeURIComponent(request.sessionId)}`} className="mt-2 inline-block text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline">
              Open the conversation →
            </Link>
          ) : null}
        </div>
        {open && canDecide && !mode ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => setMode("approve")} className={`${primaryButtonClass} h-9 text-xs`}>
              {request.status === "FAILED" ? "Try again" : "Approve"}
            </button>
            <button type="button" onClick={() => setMode("decline")} className={dangerButtonClass}>
              Decline
            </button>
          </div>
        ) : null}
      </div>

      {mode ? (
        <div className="mt-3 space-y-2 rounded-lg border border-white/10 p-3">
          <p className="text-sm text-slate-200">
            {mode === "approve"
              ? request.source === "SHOPIFY"
                ? `Refund ${money(request.amount, request.currency)} to the customer's original payment method in Shopify? This can't be undone here.`
                : `Approve this refund? AssistDesk can't send the money: your team pays ${money(request.amount, request.currency)} out to the customer.`
              : "Decline this refund? The customer is told, with your note if you add one."}
          </p>
          <label htmlFor={`refund-note-${request.id}`} className="block text-xs font-medium text-slate-400">
            Note {mode === "decline" ? "to the customer" : "(kept with the decision)"} — optional
          </label>
          <textarea id={`refund-note-${request.id}`} rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={textareaClass} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMode(null)} disabled={busy} className={secondaryButtonClass}>
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(mode)}
              className={mode === "approve" ? `${primaryButtonClass} h-9 text-xs` : dangerButtonClass}
            >
              {busy ? <Spinner /> : null}
              {mode === "approve" ? (request.source === "SHOPIFY" ? "Refund in Shopify" : "Approve refund") : "Decline refund"}
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-2">
        <NoticeBox notice={notice} />
      </div>
    </li>
  );
}

function WindowCard({ days, canEdit, shopifyConnected, onSaved }: { days: number; canEdit: boolean; shopifyConnected: boolean; onSaved: (days: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(days));
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(String(days)), [days]);

  async function save() {
    setSaving(true);
    setNotice(null);
    const response = await fetch("/api/refund-requests/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refundWindowDays: Number(value) }),
    });
    const body = await readJson<{ refundWindowDays: number }>(response);
    setSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save." });
      return;
    }

    setEditing(false);
    setNotice({ tone: "success", text: `Saved. The AI accepts refund requests up to ${body.refundWindowDays} days after the order.` });
    onSaved(body.refundWindowDays);
  }

  return (
    <Card
      title="Refund policy"
      description="What the AI checks before sending a request to you."
      action={
        canEdit && !editing ? (
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Edit
          </button>
        ) : null
      }
    >
      {editing ? (
        <div className="space-y-3">
          <label htmlFor="refund-window" className="block text-xs font-medium text-slate-400">
            Refund window (days after the order)
          </label>
          <input id="refund-window" type="number" min={1} max={365} value={value} onChange={(event) => setValue(event.target.value)} className={inputClass} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" disabled={saving} onClick={() => void save()} className={`${primaryButtonClass} h-9 text-xs`}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <ul className="space-y-2 text-sm text-slate-300">
          <li>
            Orders up to <span className="font-semibold text-white">{days} days</span> old.
          </li>
          <li>Only the customer&apos;s own order (email or phone must match).</li>
          <li>One open request per order.</li>
          <li>{shopifyConnected ? "Approving refunds the order in your Shopify store." : "No store is connected: approving marks it approved and your team pays it out."}</li>
          {!canEdit ? <li className="text-xs text-slate-500">Admins can change the refund window.</li> : null}
        </ul>
      )}
      <div className="mt-3">
        <NoticeBox notice={notice} />
      </div>
    </Card>
  );
}

export function RefundsWorkspace() {
  const [view, setView] = useState<View>("pending");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ view, page: String(page) });
    if (search) params.set("q", search);
    const response = await fetch(`/api/refund-requests?${params}`, { cache: "no-store" });
    const body = await readJson<ListResponse>(response);

    if (!response.ok) {
      setError(body.error ?? "Could not load refund requests.");
      return;
    }

    setData(body);
  }, [view, page, search]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="max-w-[1180px]">
        <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">Refunds</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          The AI collects refund requests in chat with the customer&apos;s confirmation and never refunds on its own. Approve or decline them
          here. Turn on the “Request a refund” action for an agent on its Actions tab.
        </p>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div role="tablist" aria-label="Refund views" className="flex rounded-xl bg-[#1a1a1a] p-1">
                {views.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={view === item.key}
                    onClick={() => {
                      setView(item.key);
                      setPage(1);
                    }}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${view === item.key ? "bg-[#2b2b2b] text-white" : "text-slate-400 hover:text-white"}`}
                  >
                    {item.label}
                    {item.key === "pending" && data ? <span className="ml-1.5 text-slate-500">{data.pendingCount}</span> : null}
                  </button>
                ))}
              </div>
              <input aria-label="Search refunds" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order number, name or email…" className={`${inputClass} h-10 sm:w-64`} />
            </div>

            <NoticeBox notice={notice} />
            {error ? <NoticeBox notice={{ tone: "error", text: error }} /> : null}
            {data && !data.canDecide ? <p className="text-xs text-slate-500">You can see refund requests; managers and admins approve or decline them.</p> : null}

            {!data ? (
              <p className="flex items-center text-sm text-slate-400">
                <Spinner /> Loading refund requests…
              </p>
            ) : data.requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                {search ? `No refund requests match “${search}”.` : view === "pending" ? "Nothing waiting. When the AI collects a refund request, it appears here." : "Nothing here yet."}
              </div>
            ) : (
              <ul className="space-y-2">
                {data.requests.map((request) => (
                  <RefundRow
                    key={`${request.id}-${request.status}`}
                    request={request}
                    canDecide={data.canDecide}
                    onChanged={(next) => {
                      if (next) setNotice(next);
                      setReloadToken((token) => token + 1);
                    }}
                  />
                ))}
              </ul>
            )}

            {data && pages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>
                  Page {data.page} of {pages} · {data.total} requests
                </span>
                <div className="flex gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={secondaryButtonClass}>
                    Previous
                  </button>
                  <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className={secondaryButtonClass}>
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {data ? (
            <div className="space-y-5">
              <WindowCard
                days={data.refundWindowDays}
                canEdit={data.canEditSettings}
                shopifyConnected={data.shopifyConnected}
                onSaved={(days) => setData({ ...data, refundWindowDays: days })}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
