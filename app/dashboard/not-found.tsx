import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="px-5 py-10 md:px-6">
      <div className="mx-auto max-w-lg rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-center">
        <p className="text-sm font-semibold text-slate-400">404</p>
        <h1 className="heading-font mt-2 text-2xl font-bold text-white">
          We couldn&apos;t find that page.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          It may have been deleted, or the link may be wrong. Head back to the overview
          and pick it from the sidebar.
        </p>
        <Link
          href="/dashboard"
          className="pressable mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
