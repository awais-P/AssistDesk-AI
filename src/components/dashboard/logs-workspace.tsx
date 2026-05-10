"use client";

import { useMemo, useState } from "react";

type LogItem = {
  id: string;
  date: string;
  status: string;
  model: string;
  tokens: number;
  duration: string;
  ticketId: string;
};

type LogsWorkspaceProps = {
  initialLogs: LogItem[];
};

export function LogsWorkspace({ initialLogs }: LogsWorkspaceProps) {
  const [search, setSearch] = useState("");

  const filteredLogs = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return initialLogs;
    }

    return initialLogs.filter((log) =>
      log.ticketId.toLowerCase().includes(value),
    );
  }, [initialLogs, search]);

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
            Logs
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Monitor automation jobs and AI model usage
          </p>
        </div>

        <div className="inline-flex h-12 items-center rounded-lg border border-white/10 bg-[#111111] px-3">
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
            placeholder="Search by Ticket Id"
            className="ml-3 w-[230px] bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="mt-6 rounded-[22px] border border-white/10 bg-[#0a0a0a]">
        <div className="grid grid-cols-5 gap-4 border-b border-white/10 px-4 py-5 text-sm font-semibold text-white">
          <span>Date</span>
          <span>Status</span>
          <span>Model</span>
          <span>Tokens</span>
          <span>Duration</span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-16 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-10 w-10 text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M4 12h5l2-5 3 10 2-5h4" />
            </svg>
            <p className="mt-4 text-xl text-slate-300">No logs available</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-5 gap-4 border-b border-white/10 px-4 py-5 text-sm text-white last:border-b-0"
            >
              <span>{log.date}</span>
              <span>{log.status}</span>
              <span>{log.model}</span>
              <span>{log.tokens}</span>
              <span>{log.duration}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
