type DashboardPageHeaderProps = {
  title: string;
  actionLabel?: string;
  actionStyle?: "light" | "dark";
};

export function DashboardPageHeader({
  title,
  actionLabel,
  actionStyle = "dark",
}: DashboardPageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <h1 className="heading-font text-4xl font-bold text-white">{title}</h1>

      {actionLabel ? (
        <button
          type="button"
          className={
            actionStyle === "light"
              ? "w-fit rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200"
              : "w-fit rounded-xl border border-white/10 bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          }
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
