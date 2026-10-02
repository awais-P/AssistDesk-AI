"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnalyticsNav } from "@/src/components/dashboard/analytics-nav";
import {
  AnsweredBadge,
  ChannelChips,
  EmptyState,
  Panel,
  StatTile,
  channelLabel,
  formatDateTime,
  formatEnum,
  formatNumber,
  plural,
  primaryButtonClass,
  readJson,
  secondaryButtonClass,
  textLinkClass,
} from "@/src/components/dashboard/analytics-ui";
import type { ImprovementAreas } from "@/src/lib/analytics";

type AnalyticsImproveWorkspaceProps = {
  data: ImprovementAreas;
  canTrain: boolean;
};

type Gap = ImprovementAreas["knowledgeGaps"][number];
type Feedback = ImprovementAreas["negativeFeedback"][number];

/** What the knowledge-base modal is teaching: a gap cluster or one unhelpful reply. */
type TeachTarget = {
  key: string;
  question: string;
  otherWordings: string[];
  /** AiInteraction ids to mark as handled once the answer is saved (gaps only). */
  interactionIds: string[];
  kind: "gap" | "feedback";
};

type Toast = {
  tone: "success" | "error";
  text: string;
  href?: string;
  hrefLabel?: string;
  undo?: () => void;
};

const TITLE_MAX = 160;
const MAX_SESSION_LINKS = 4;

function chatHref(sessionId: string) {
  return `/dashboard/chats?session=${encodeURIComponent(sessionId)}`;
}

function transcriptHref(sessionId: string) {
  return `/api/chat-sessions/${encodeURIComponent(sessionId)}/transcript`;
}

function sourceText(question: string, answer: string, otherWordings: string[]) {
  const lines = [`Q: ${question.trim()}`, `A: ${answer.trim()}`];

  if (otherWordings.length > 0) {
    lines.push(`Also asked as: ${otherWordings.map((wording) => wording.trim()).join("; ")}`);
  }

  return lines.join("\n");
}

async function markReviewed(ids: string[], reviewed: boolean) {
  const response = await fetch("/api/analytics/interactions/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, reviewed }),
  });
  const payload = await readJson<{ updated?: number; reviewed?: boolean; error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || "Could not update these questions. Please try again.");
  }

  return payload.updated ?? 0;
}

export function AnalyticsImproveWorkspace({ data, canTrain }: AnalyticsImproveWorkspaceProps) {
  const timeZone = data.range.timeZone;
  const [gaps, setGaps] = useState<Gap[]>(data.knowledgeGaps);
  const [openGaps, setOpenGaps] = useState(data.gapStats.open);
  const [reviewed, setReviewed] = useState(data.gapStats.reviewed);
  const [answeredFeedback, setAnsweredFeedback] = useState<Set<string>>(() => new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [teach, setTeach] = useState<TeachTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // A new range from the header re-renders the server page with fresh data.
  const [source, setSource] = useState(data);
  if (source !== data) {
    setSource(data);
    setGaps(data.knowledgeGaps);
    setOpenGaps(data.gapStats.open);
    setReviewed(data.gapStats.reviewed);
    setAnsweredFeedback(new Set());
    setItemErrors({});
  }

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), toast.undo ? 15000 : 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function setItemError(key: string, message: string | null) {
    setItemErrors((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  function removeGap(gap: Gap) {
    setGaps((current) => current.filter((item) => item !== gap));
    setOpenGaps((count) => Math.max(0, count - gap.count));
    setReviewed((count) => count + gap.count);
  }

  function restoreGap(gap: Gap, index: number) {
    setGaps((current) => {
      if (current.includes(gap)) return current;
      const next = [...current];
      next.splice(Math.min(index, next.length), 0, gap);
      return next;
    });
    setOpenGaps((count) => count + gap.count);
    setReviewed((count) => Math.max(0, count - gap.count));
  }

  async function handleMarkHandled(gap: Gap) {
    const key = gap.interactionIds[0] ?? gap.label;
    const index = gaps.indexOf(gap);
    setBusyKey(key);
    setItemError(key, null);

    try {
      await markReviewed(gap.interactionIds, true);
      removeGap(gap);
      setToast({
        tone: "success",
        text: `Marked “${gap.label}” as handled.`,
        undo: () => {
          setToast(null);
          void (async () => {
            try {
              await markReviewed(gap.interactionIds, false);
              restoreGap(gap, index);
            } catch (error) {
              setToast({ tone: "error", text: error instanceof Error ? error.message : "Could not undo." });
            }
          })();
        },
      });
    } catch (error) {
      setItemError(key, error instanceof Error ? error.message : "Could not update this question.");
    } finally {
      setBusyKey(null);
    }
  }

  function openTeachForGap(gap: Gap) {
    setTeach({
      key: gap.interactionIds[0] ?? gap.label,
      question: gap.label,
      otherWordings: gap.examples.filter((example) => example.trim() !== gap.label.trim()),
      interactionIds: gap.interactionIds,
      kind: "gap",
    });
  }

  function openTeachForFeedback(item: Feedback) {
    setTeach({
      key: item.id,
      question: item.question ?? "",
      otherWordings: [],
      interactionIds: [],
      kind: "feedback",
    });
  }

  function handleSaved(target: TeachTarget, reviewError: string | null) {
    setTeach(null);

    if (target.kind === "gap") {
      const gap = gaps.find((item) => (item.interactionIds[0] ?? item.label) === target.key);
      if (gap && !reviewError) removeGap(gap);
      if (reviewError) setItemError(target.key, `Answer saved, but the question could not be marked as handled: ${reviewError}`);
    } else {
      setAnsweredFeedback((current) => new Set(current).add(target.key));
    }

    setToast({
      tone: "success",
      text: "Answer added to the knowledge base. The assistant will use it once indexing finishes.",
      href: "/dashboard/knowledge-base",
      hrefLabel: "Open knowledge base",
    });
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <AnalyticsNav
        title="Improve"
        description="Questions the assistant couldn't answer well, replies customers didn't find helpful, and why conversations went to your team."
        range={data.range}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Open knowledge gaps"
          value={formatNumber(openGaps)}
          detail="Questions not answered from your knowledge"
        />
        <StatTile label="Reviewed" value={formatNumber(reviewed)} detail="Gaps your team has handled" />
        <StatTile
          label="Unhelpful replies"
          value={formatNumber(data.negativeFeedback.length)}
          detail={data.negativeFeedback.length >= 50 ? "Latest 50 thumbs-down ratings" : "Rated thumbs-down by customers"}
        />
        <StatTile label="Escalations" value={formatNumber(data.escalationCount)} detail="Conversations a human took over" />
        <StatTile
          label="Unanswered conversations"
          value={formatNumber(data.unanswered.length)}
          detail={data.unanswered.length >= 20 ? "Latest 20 ended without a reply" : "Ended without a reply"}
        />
      </div>

      {!canTrain ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-3 text-sm text-slate-400">
          You can review everything here. Adding answers to the knowledge base and marking questions as handled needs the
          Manager role or higher.
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-8">
        {/* Knowledge gaps (FE-5) */}
        <section aria-labelledby="gaps-title">
          <h2 id="gaps-title" className="text-lg font-semibold text-white">
            Knowledge gaps
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Questions answered without your knowledge base or with the fallback reply, grouped by similar wording. Most
            asked first.
          </p>

          <div className="mt-4 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
            {gaps.length === 0 ? (
              <EmptyState title="No knowledge gaps in this period 🎉">
                Every question was answered from your knowledge base.
              </EmptyState>
            ) : (
              <ol>
                {gaps.map((gap) => {
                  const key = gap.interactionIds[0] ?? gap.label;
                  const otherWordings = gap.examples.filter((example) => example.trim() !== gap.label.trim());
                  const busy = busyKey === key;
                  return (
                    <li key={key} className="flex flex-col gap-4 border-b border-white/10 px-5 py-4 last:border-b-0 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-medium text-white">{gap.label}</p>
                        <p className="mt-1 text-sm text-slate-400">
                          Asked {plural(gap.count, "time")} · last {formatDateTime(gap.lastAskedAt, timeZone)}
                          {gap.fallbackRate !== null && gap.fallbackRate > 0
                            ? ` · fallback reply ${Math.round(gap.fallbackRate * 100)}% of the time`
                            : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <ChannelChips channels={gap.channels} />
                          <AnsweredBadge rate={gap.answeredRate} />
                        </div>
                        {otherWordings.length > 0 ? (
                          <details className="group mt-2 text-sm">
                            <summary className="cursor-pointer list-none text-slate-400 transition hover:text-white [&::-webkit-details-marker]:hidden">
                              <span aria-hidden="true" className="mr-1 inline-block transition group-open:rotate-90">
                                ›
                              </span>
                              Other ways it was asked ({otherWordings.length})
                            </summary>
                            <ul className="mt-2 space-y-1 border-l border-white/10 pl-3 text-slate-400">
                              {otherWordings.map((wording) => (
                                <li key={wording} className="break-words">
                                  “{wording}”
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {itemErrors[key] ? (
                          <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                            {itemErrors[key]}
                          </p>
                        ) : null}
                      </div>
                      {canTrain ? (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button type="button" disabled={busy} onClick={() => openTeachForGap(gap)} className={primaryButtonClass}>
                            Add answer to knowledge base
                          </button>
                          <button type="button" disabled={busy} onClick={() => void handleMarkHandled(gap)} className={secondaryButtonClass}>
                            {busy ? "Saving..." : "Mark as handled"}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* Unhelpful replies (FE-5, FE-2 transcripts for QA) */}
        <section aria-labelledby="feedback-title">
          <h2 id="feedback-title" className="text-lg font-semibold text-white">
            Unhelpful replies
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            AI replies customers rated thumbs-down. Open the conversation or download the transcript for quality review.
          </p>

          {data.negativeFeedback.length === 0 ? (
            <div className="mt-4 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
              <EmptyState title="No unhelpful replies in this period">
                No customer rated an AI reply thumbs-down. Ratings come from the website chat widget.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 grid gap-4 xl:grid-cols-2">
              {data.negativeFeedback.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  timeZone={timeZone}
                  canTrain={canTrain}
                  answered={answeredFeedback.has(item.id)}
                  onTeach={() => openTeachForFeedback(item)}
                />
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Escalation reasons (FE-5) */}
          <Panel
            id="escalations"
            title="Why conversations were escalated"
            description={
              data.escalationCount > 0
                ? `The customer's last message before a person took over, grouped by similar wording (${plural(data.escalationCount, "escalation")}).`
                : "The customer's last message before a person took over."
            }
          >
            {data.escalations.length === 0 ? (
              <EmptyState title="No escalations in this period">
                The assistant handled every conversation without handing over to your team.
              </EmptyState>
            ) : (
              <ol className="space-y-4">
                {data.escalations.map((cluster, index) => {
                  const otherWordings = cluster.examples.filter((example) => example.trim() !== cluster.label.trim());
                  return (
                    <li key={`${index}-${cluster.label}`} className="border-b border-white/10 pb-4 last:border-b-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-medium text-white">“{cluster.label}”</p>
                        <span className="shrink-0 text-sm tabular-nums text-slate-400">{plural(cluster.count, "time")}</span>
                      </div>
                      {otherWordings.length > 0 ? (
                        <p className="mt-1 break-words text-sm text-slate-500">
                          Also: {otherWordings.map((wording) => `“${wording}”`).join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <ChannelChips channels={cluster.channels} />
                        <span className="text-xs text-slate-500">last {formatDateTime(cluster.lastAskedAt, timeZone)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        {cluster.sessionIds.slice(0, MAX_SESSION_LINKS).map((sessionId, sessionIndex) => (
                          <Link key={sessionId} href={chatHref(sessionId)} className={textLinkClass}>
                            Conversation {sessionIndex + 1}
                          </Link>
                        ))}
                        {cluster.sessionIds.length > MAX_SESSION_LINKS ? (
                          <span className="text-slate-500">+{cluster.sessionIds.length - MAX_SESSION_LINKS} more</span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          {/* Unanswered conversations */}
          <Panel id="unanswered" title="Unanswered conversations" description="Conversations that ended without any reply.">
            {data.unanswered.length === 0 ? (
              <EmptyState title="No unanswered conversations">Every conversation in this period got a reply.</EmptyState>
            ) : (
              <ul className="divide-y divide-white/10">
                {data.unanswered.map((session) => (
                  <li key={session.sessionId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 text-sm">
                      <p className="text-slate-200">
                        {channelLabel(session.channel)}
                        <span className="text-slate-500"> · ended {formatDateTime(session.endedAt, timeZone)}</span>
                      </p>
                      {session.closedReason ? (
                        <p className="mt-0.5 text-xs text-slate-500">{formatEnum(session.closedReason)}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      <Link href={chatHref(session.sessionId)} className={textLinkClass}>
                        Open
                      </Link>
                      <a href={transcriptHref(session.sessionId)} className={textLinkClass}>
                        Transcript
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {teach ? (
        <TeachModal
          target={teach}
          agents={data.agents}
          onClose={() => setTeach(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {toast ? (
        <div
          role={toast.tone === "error" ? "alert" : "status"}
          className={`fixed bottom-5 right-5 z-50 flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm shadow-2xl ${
            toast.tone === "error"
              ? "border-red-500/30 bg-[#1a0b0b] text-red-200"
              : "border-emerald-500/30 bg-[#08140f] text-emerald-200"
          }`}
        >
          <span className="min-w-0 flex-1">{toast.text}</span>
          {toast.href ? (
            <Link href={toast.href} className="font-semibold underline underline-offset-2">
              {toast.hrefLabel ?? "Open"}
            </Link>
          ) : null}
          {toast.undo ? (
            <button type="button" onClick={toast.undo} className="font-semibold underline underline-offset-2">
              Undo
            </button>
          ) : null}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FeedbackCard({
  item,
  timeZone,
  canTrain,
  answered,
  onTeach,
}: {
  item: Feedback;
  timeZone: string;
  canTrain: boolean;
  answered: boolean;
  onTeach: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = item.answer.length > 220 || item.answer.split("\n").length > 3;

  return (
    <li className="flex flex-col rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-300">
          {channelLabel(item.channel)}
        </span>
        {item.agent ? <span>{item.agent}</span> : null}
        <span>{formatDateTime(item.createdAt, timeZone)}</span>
        {item.grounded !== null ? (
          <span>{item.grounded ? "Answered from knowledge" : "Not from knowledge"}</span>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Customer asked</p>
      <p className={`mt-1 break-words ${item.question ? "text-white" : "italic text-slate-500"}`}>
        {item.question ?? "Question not recorded"}
      </p>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Assistant replied</p>
      <p className={`mt-1 whitespace-pre-line break-words text-sm text-slate-300 ${expanded ? "" : "line-clamp-3"}`}>{item.answer}</p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-1 w-fit text-sm text-slate-400 transition hover:text-white"
        >
          {expanded ? "Show less" : "Show full reply"}
        </button>
      ) : null}

      {item.comment ? (
        <blockquote className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
          <span className="text-xs text-slate-500">Customer comment · </span>
          {item.comment}
        </blockquote>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-sm">
        {item.sessionId ? (
          <>
            <Link href={chatHref(item.sessionId)} className={textLinkClass}>
              Open conversation
            </Link>
            <a href={transcriptHref(item.sessionId)} className={textLinkClass}>
              Download transcript
            </a>
          </>
        ) : null}
        {canTrain ? (
          answered ? (
            <span className="text-emerald-200">Answer added to knowledge base</span>
          ) : (
            <button type="button" onClick={onTeach} className="ml-auto font-medium text-white transition hover:text-slate-300">
              Add correct answer to knowledge base
            </button>
          )
        ) : null}
      </div>
    </li>
  );
}

function TeachModal({
  target,
  agents,
  onClose,
  onSaved,
}: {
  target: TeachTarget;
  agents: ImprovementAreas["agents"];
  onClose: () => void;
  onSaved: (target: TeachTarget, reviewError: string | null) => void;
}) {
  const [title, setTitle] = useState(target.question.slice(0, TITLE_MAX));
  const [answer, setAnswer] = useState("");
  const [agentId, setAgentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = sourceText(title || "…", answer || "…", target.otherWordings);

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Enter the question.");
      return;
    }

    if (!answer.trim()) {
      setError("Write the answer the assistant should give.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/knowledge-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "TEXT",
          title: title.trim(),
          rawText: sourceText(title, answer, target.otherWordings),
          agentId: agentId || null,
        }),
      });
      const payload = await readJson<{ error?: string }>(response);

      if (!response.ok) {
        throw new Error(payload.error || "Could not add this answer to the knowledge base.");
      }

      let reviewError: string | null = null;

      if (target.interactionIds.length > 0) {
        try {
          await markReviewed(target.interactionIds, true);
        } catch (reviewFailure) {
          reviewError = reviewFailure instanceof Error ? reviewFailure.message : "Unknown error";
        }
      }

      onSaved(target, reviewError);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not add this answer to the knowledge base.");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 px-4 py-6"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teach-title"
        className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0b0b0b] p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">Knowledge base</p>
            <h2 id="teach-title" className="heading-font mt-1 text-2xl font-semibold text-white">
              {target.kind === "gap" ? "Add an answer" : "Add the correct answer"}
            </h2>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            Close
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-400">
          Saved as a text source in your knowledge base, so the assistant can answer this next time.
          {target.interactionIds.length > 0 ? " The question is then marked as handled." : ""}
        </p>

        <form
          className="mt-6 grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div>
            <label htmlFor="teach-question" className="mb-2 block text-sm font-medium text-white">
              Question
            </label>
            <input
              id="teach-question"
              type="text"
              maxLength={TITLE_MAX}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What did the customer ask?"
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
            />
          </div>
          <div>
            <label htmlFor="teach-answer" className="mb-2 block text-sm font-medium text-white">
              Answer <span className="text-slate-500">(required)</span>
            </label>
            <textarea
              id="teach-answer"
              required
              autoFocus
              rows={5}
              maxLength={5000}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="The answer the assistant should give"
              className="w-full resize-y rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
            />
          </div>
          <div>
            <label htmlFor="teach-agent" className="mb-2 block text-sm font-medium text-white">
              AI agent <span className="text-slate-500">(optional)</span>
            </label>
            <select
              id="teach-agent"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-3 text-white outline-none"
            >
              <option value="">All agents in this workspace</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-white">Preview</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-sans text-sm text-slate-300">
              {preview}
            </pre>
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] disabled:bg-neutral-400"
            >
              {saving ? "Saving..." : "Add to knowledge base"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
