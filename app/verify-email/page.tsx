"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const errorParam = searchParams.get("error") || "";
  const isVerifiedParam = searchParams.get("verified") === "true";
  const isPending = searchParams.get("pending") === "true";
  const emailParam = searchParams.get("email") || "";

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(
    isVerifiedParam ? "success" : "idle",
  );
  const [errorMessage, setErrorMessage] = useState(
    errorParam === "expired_token"
      ? "This verification link has expired. Please request a new one."
      : errorParam
        ? "Invalid verification link. Please check your email or request a new link."
        : "",
  );
  const [resendEmail, setResendEmail] = useState(emailParam);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  useEffect(() => {
    if (isVerifiedParam) {
      setStatus("success");
      return;
    }

    if (errorParam) {
      setStatus("error");
      return;
    }

    if (token) {
      setStatus("verifying");
      fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
            redirectTo?: string;
          };
          if (res.ok) {
            setStatus("success");
            if (data.redirectTo) {
              setTimeout(() => {
                window.location.assign(data.redirectTo || "/setup");
              }, 1200);
            }
          } else {
            setStatus("error");
            setErrorMessage(data.error || "Verification failed. The link may be invalid or expired.");
          }
        })
        .catch(() => {
          setStatus("error");
          setErrorMessage("Failed to verify. Please check your connection and try again.");
        });
    }
  }, [token, isVerifiedParam, errorParam]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail.trim() || isResending) return;

    setIsResending(true);
    setResendMessage("");

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail.trim() }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (response.ok) {
        setResendMessage(data.message || "Confirmation email sent! Check your inbox.");
      } else {
        setResendMessage(data.error || "Failed to resend confirmation email.");
      }
    } catch {
      setResendMessage("Network error. Please try again.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8 text-center">
      {status === "verifying" ? (
        <div>
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
          <h1 className="heading-font text-2xl font-bold text-white">Verifying your email...</h1>
          <p className="mt-2 text-sm text-slate-400">Please wait while we confirm your email address.</p>
        </div>
      ) : null}

      {status === "success" ? (
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="heading-font text-2xl font-bold text-white">Email Verified!</h1>
          <p className="mt-2 text-sm text-slate-300">
            Your email has been confirmed. You can now proceed to set up your AssistDesk workspace.
          </p>
          <div className="mt-6">
            <Link
              href="/setup"
              className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200"
            >
              Continue to Onboarding &rarr;
            </Link>
          </div>
        </div>
      ) : null}

      {status === "error" ? (
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="heading-font text-2xl font-bold text-white">Verification Failed</h1>
          <p className="mt-2 text-sm text-red-200">{errorMessage}</p>

          <form onSubmit={handleResend} className="mt-6 space-y-3 text-left">
            <label htmlFor="resend-email" className="block text-xs font-medium text-slate-300">
              Need another link? Enter your email address:
            </label>
            <input
              id="resend-email"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white outline-none focus:border-white"
            />
            <button
              type="submit"
              disabled={isResending}
              className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {isResending ? "Sending..." : "Resend Confirmation Email"}
            </button>
            {resendMessage ? (
              <p className="text-xs text-amber-200">{resendMessage}</p>
            ) : null}
          </form>

          <div className="mt-6 text-sm text-slate-400">
            <Link href="/login" className="underline hover:text-white">
              Back to Log In
            </Link>
          </div>
        </div>
      ) : null}

      {status === "idle" && (isPending || !token) ? (
        <div>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="heading-font text-2xl font-bold text-white">Check Your Inbox</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {emailParam ? (
              <>
                We sent a confirmation email to <span className="font-semibold text-white">{emailParam}</span>.
              </>
            ) : (
              "We sent a confirmation email to your email address."
            )}{" "}
            Please click the link inside to verify your account before logging in.
          </p>

          <form onSubmit={handleResend} className="mt-6 space-y-3 text-left">
            <label htmlFor="pending-resend-email" className="block text-xs font-medium text-slate-300">
              Didn&apos;t receive it? Enter your email to resend:
            </label>
            <input
              id="pending-resend-email"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white outline-none focus:border-white"
            />
            <button
              type="submit"
              disabled={isResending}
              className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              {isResending ? "Sending..." : "Resend Confirmation Email"}
            </button>
            {resendMessage ? (
              <p className="text-xs text-amber-200">{resendMessage}</p>
            ) : null}
          </form>

          <div className="mt-6 text-sm text-slate-400">
            Already verified?{" "}
            <Link href="/login" className="font-semibold text-white underline">
              Log in here
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="page-shell pb-12">
      <SiteNavbar />
      <main className="section-wrap pt-12 md:pt-20">
        <Suspense
          fallback={
            <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center text-slate-400">
              Loading...
            </div>
          }
        >
          <VerifyEmailContent />
        </Suspense>
      </main>
    </div>
  );
}
