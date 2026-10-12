"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] Page failed to render:", error);
  }, [error]);

  return (
    <div className="px-5 py-10 md:px-6">
      <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center">
        <p className="text-sm font-semibold text-red-300">Error</p>
        <h1 className="heading-font mt-2 text-2xl font-bold text-white">
          Something went wrong loading this page.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Try again; if it keeps happening check the server logs.
        </p>
        {error.digest ? (
          <p className="mt-2 text-xs text-slate-500">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Retry
          </button>
          <Link
            href="/dashboard"
            className="pressable inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          >
            Go to Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
