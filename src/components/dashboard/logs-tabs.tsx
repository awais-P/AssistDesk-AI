import Link from "next/link";

/** Logs sections: automation jobs (Module 11) and the AI's actions (Module 2 FE-5). */
export function LogsTabs({ active }: { active: "automation" | "actions" }) {
  const tabs = [
    { key: "automation", label: "Automation", href: "/dashboard/logs" },
    { key: "actions", label: "AI actions", href: "/dashboard/logs?tab=actions" },
  ] as const;

  return (
    <nav aria-label="Log types" className="mt-5 inline-flex rounded-xl bg-[#1a1a1a] p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            active === tab.key ? "bg-[#2b2b2b] text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
