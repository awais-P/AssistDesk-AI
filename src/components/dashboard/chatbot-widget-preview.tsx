"use client";

import { getChatbotInitial } from "@/src/lib/chatbot-config";

type ChatbotWidgetPreviewProps = {
  name: string;
  primaryColor: string;
  welcomeMessage: string;
  avatarUrl?: string | null;
  conversationStarters?: string[];
  isActive?: boolean;
  position?: "BOTTOM_RIGHT" | "BOTTOM_LEFT";
  emailNotifications?: boolean;
};

export function ChatbotWidgetPreview({
  name,
  primaryColor,
  welcomeMessage,
  avatarUrl = null,
  conversationStarters = [],
  isActive = true,
  position = "BOTTOM_RIGHT",
  emailNotifications = true,
}: ChatbotWidgetPreviewProps) {
  const visibleStarters = conversationStarters
    .map((starter) => starter.trim())
    .filter(Boolean);

  return (
    <div className="relative flex min-h-[720px] items-end justify-center overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_38%),linear-gradient(180deg,#0b0d13_0%,#090b10_100%)] px-5 py-6">
      <div
        className={`absolute bottom-5 ${position === "BOTTOM_LEFT" ? "left-5" : "right-5"} flex h-16 w-16 items-center justify-center rounded-full text-white shadow-[0_22px_44px_rgba(59,130,246,0.38)]`}
        style={{ backgroundColor: primaryColor }}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v6A1.5 1.5 0 0 1 18 16.5H11l-4.5 3V16.5H6A1.5 1.5 0 0 1 4.5 15V9A1.5 1.5 0 0 1 6 7.5Z" />
        </svg>
      </div>

      <div className="w-full max-w-[400px] overflow-hidden rounded-[30px] border border-black/10 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.34)]">
        <div
          className="relative overflow-hidden px-6 pb-5 pt-7 text-white"
          style={{ backgroundColor: primaryColor }}
        >
          <div className="flex items-start justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full border border-white/30 object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/15 text-lg font-semibold">
                  {getChatbotInitial(name)}
                </span>
              )}

              <div className="min-w-0">
                <p className="truncate text-[1.5rem] font-semibold leading-none">
                  {name}
                </p>
                <div className="mt-2 flex items-center gap-2 text-sm text-white/90">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isActive ? "bg-emerald-400" : "bg-slate-300"
                    }`}
                  />
                  <span>{isActive ? "Online" : "Paused"}</span>
                </div>
              </div>
            </div>

            <span
              className="rounded-full p-2 text-white/90"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="currentColor"
              >
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </span>
          </div>

          <div className="absolute -bottom-4 left-6 h-12 w-[62%] rounded-tl-[20px] rounded-tr-[18px] bg-white/12" />
        </div>

        <div className="min-h-[360px] space-y-4 px-6 py-6">
          <div className="max-w-[76%] whitespace-pre-line rounded-[22px] bg-[#eef4ff] px-5 py-4 text-sm leading-6 text-slate-700 shadow-sm">
            {welcomeMessage}
          </div>

          {visibleStarters.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {visibleStarters.map((starter, index) => (
                <span
                  key={`${index}-${starter}`}
                  className="rounded-full border bg-white px-4 py-2 text-sm font-medium shadow-sm"
                  style={{ borderColor: primaryColor, color: primaryColor }}
                >
                  {starter}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {emailNotifications ? (
          <div className="flex items-center gap-3 border-y border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-amber-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M4 7.5h16v9H4z" />
              <path d="m5 8 7 6 7-6" />
            </svg>
            <span>Click here to set your email to get notifications</span>
          </div>
        ) : null}

        <div className="px-5 pb-4 pt-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 flex-1 items-center rounded-full border border-slate-200 px-5 text-sm text-slate-400">
              Send a message...
            </div>
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg"
              style={{ backgroundColor: primaryColor }}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m5 12 14-7-4 14-3-4-4-3Z" />
              </svg>
            </div>
          </div>

          <p className="mt-3 text-center text-xs text-slate-400">
            Powered by <span className="font-semibold text-slate-600">AssistDesk AI</span>
          </p>
        </div>
      </div>
    </div>
  );
}
