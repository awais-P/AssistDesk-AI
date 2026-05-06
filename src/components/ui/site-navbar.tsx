import Link from "next/link";

export function SiteNavbar() {
  return (
    <header className="border-b border-white/10 bg-black">
      <nav className="section-wrap flex flex-col gap-4 px-0 py-4 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white text-lg font-bold text-black">
            A
          </span>
          <div>
            <p className="heading-font text-xl font-bold text-white">
              AssistDesk
            </p>
            <p className="text-xs text-slate-400">
              AI support automation platform
            </p>
          </div>
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          <Link href="/" className="text-sm font-medium text-white">
            Home
          </Link>
          <Link href="/#features" className="text-sm font-medium text-slate-300">
            Features
          </Link>
          <Link href="/#about" className="text-sm font-medium text-slate-300">
            About
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="pressable inline-flex min-w-[104px] items-center justify-center rounded-xl border border-white/15 bg-black px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/5"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="pressable inline-flex min-w-[112px] items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Sign Up
          </Link>
        </div>
      </nav>
    </header>
  );
}
