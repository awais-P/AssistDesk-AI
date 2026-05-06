type DashboardPageHeaderProps = {
  title: string;
  actionLabel?: string;
  actionStyle?: "light" | "dark";
  onActionClick?: () => void;
};

export function DashboardPageHeader({
  title,
  actionLabel,
  actionStyle = "dark",
  onActionClick,
}: DashboardPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">
        {title}
      </h1>

      {actionLabel ? (
        <button
          type="button"
          onClick={onActionClick}
          className={
            actionStyle === "light"
              ? "inline-flex h-10 w-fit items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition hover:bg-neutral-200"
              : "inline-flex h-10 w-fit items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
          }
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
