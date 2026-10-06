"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { executionStatusLabels, executionStatusTone } from "./run-timeline";
import { Badge, readJson } from "./tool-ui";

/**
 * Module 2 FE-5 in the Chats side panel: the actions the AI took in this conversation,
 * with a link to each one's chain of thought. Hidden while the chat has none.
 */

type ChatAction = {
  id: string;
  runId: string | null;
  toolName: string;
  status: string;
  reasoning: string | null;
  error: string | null;
  triggeredBy: string;
  createdAt: string;
};

const linkClass = "rounded text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline";

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

export function ChatActionsSection({ sessionId, refreshKey }: { sessionId: string; refreshKey: string | number | null }) {
  const [actions, setActions] = useState<ChatAction[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/action-logs?view=actions&session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const body = await readJson<{ rows: ChatAction[]; total: number }>(response);
      if (cancelled || !response.ok) return;
      setActions(body.rows);
      setTotal(body.total);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!actions || actions.length === 0) {
    return null;
  }

  const pending = actions.find((action) => action.status === "PENDING_CONFIRMATION");
  const shown = actions.slice(0, 6);

  return (
    <section className="border-b border-white/10 px-5 py-5 last:border-b-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">AI actions</h3>
        <Link href={`/dashboard/logs?tab=actions&view=actions&session=${encodeURIComponent(sessionId)}`} className={linkClass}>
          All {total}
        </Link>
      </div>

      {pending ? (
        <p className="mb-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-100">
          Waiting for the customer to say yes or no: {pending.toolName}. It runs only after they confirm.
        </p>
      ) : null}

      <ul className="space-y-2.5">
        {shown.map((action) => (
          <li key={action.id} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-white">{action.toolName}</span>
              <Badge tone={executionStatusTone(action.status)}>{executionStatusLabels[action.status] ?? action.status}</Badge>
            </div>
            {action.reasoning ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{action.reasoning}</p> : null}
            {action.error ? <p className="mt-1 line-clamp-2 text-xs text-red-300">{action.error}</p> : null}
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                {timeAgo(action.createdAt)}
                {action.triggeredBy === "CONFIRMATION" ? " · after customer's yes" : action.triggeredBy === "RULE" ? " · automatic" : ""}
              </span>
              {action.runId ? (
                <Link href={`/dashboard/logs?tab=actions&run=${encodeURIComponent(action.runId)}`} className={linkClass}>
                  Why?
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
