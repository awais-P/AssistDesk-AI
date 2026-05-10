"use client";

import { useMemo, useState } from "react";

type ChatMessageItem = {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
};

type ChatSessionItem = {
  id: string;
  customerName: string | null;
  customerEmail: string | null;
  status: string;
  channel: string;
  startedAt: string;
  chatbotName: string | null;
  messages: ChatMessageItem[];
};

type ChatsWorkspaceProps = {
  initialSessions: ChatSessionItem[];
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ChatsWorkspace({ initialSessions }: ChatsWorkspaceProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialSessions[0]?.id ?? "");

  const filteredSessions = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return initialSessions;
    }

    return initialSessions.filter((session) => {
      return (
        session.customerName?.toLowerCase().includes(value) ||
        session.customerEmail?.toLowerCase().includes(value) ||
        session.chatbotName?.toLowerCase().includes(value)
      );
    });
  }, [initialSessions, search]);

  const selectedSession =
    filteredSessions.find((session) => session.id === selectedId) ?? null;

  return (
    <div className="h-[calc(100vh-32px)] overflow-hidden px-0 py-0">
      <div className="grid h-full lg:grid-cols-[360px_1fr]">
        <aside className="border-r border-white/10 bg-black">
          <div className="border-b border-white/10 p-4">
            <div className="inline-flex h-12 w-full items-center rounded-lg border border-white/10 bg-[#111111] px-3">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3-3" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search..."
                className="ml-3 w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="h-[calc(100%-81px)] overflow-y-auto">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => setSelectedId(session.id)}
                className={`w-full border-b border-white/5 px-4 py-4 text-left transition ${
                  selectedId === session.id
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">
                      {session.customerName || "Anonymous visitor"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {session.customerEmail || session.chatbotName || "Web widget"}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-[#111111] px-2.5 py-1 text-[11px] text-slate-300">
                    {session.status}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {formatTime(session.startedAt)}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex h-full items-center justify-center bg-black px-6">
          {selectedSession ? (
            <div className="flex h-full w-full max-w-4xl flex-col py-6">
              <div className="border-b border-white/10 pb-4">
                <p className="text-xl font-semibold text-white">
                  {selectedSession.customerName || "Anonymous visitor"}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {selectedSession.customerEmail || "No email provided"} •{" "}
                  {selectedSession.channel}
                </p>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto py-6">
                {selectedSession.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.sender === "USER"
                        ? "ml-auto bg-white text-[#050505]"
                        : "bg-[#111111] text-white"
                    }`}
                  >
                    <p>{message.content}</p>
                    <p
                      className={`mt-2 text-xs ${
                        message.sender === "USER"
                          ? "text-[#050505]/70"
                          : "text-slate-500"
                      }`}
                    >
                      {formatTime(message.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-lg text-slate-400">No session selected</p>
          )}
        </section>
      </div>
    </div>
  );
}
