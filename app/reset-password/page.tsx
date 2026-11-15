"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";
import { getPasswordRules } from "../../src/lib/form-validation";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  const passwordRules = getPasswordRules(password);
  const passwordValid = passwordRules.every((rule) => rule.met);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!token) {
      setError("Password reset token is missing. Please use the link sent to your email.");
      return;
    }

    if (!passwordValid) {
      setError("Your password does not meet the requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, password }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        expired?: boolean;
        message?: string;
      };

      if (!response.ok) {
        if (data.expired) {
          setIsExpired(true);
        }
        setError(data.error ?? "Failed to reset password. The link may be expired.");
        setIsLoading(false);
        return;
      }

      setIsSuccess(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/20 text-red-400">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="heading-font text-2xl font-bold text-white">Missing Reset Token</h1>
        <p className="mt-2 text-sm text-slate-400">
          This password reset link is invalid or incomplete. Please request a new link.
        </p>
        <div className="mt-6">
          <Link
            href="/forgot-password"
            className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200"
          >
            Request New Link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
      <div className="mb-6">
        <h1 className="heading-font text-3xl font-bold text-white">
          Reset password
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Enter a new secure password for your AssistDesk account.
        </p>
      </div>

      {isSuccess ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-semibold text-lg text-white">Password Reset Complete</p>
          <p className="text-sm text-slate-300">
            Your password has been changed. You can now log in with your new credentials.
          </p>
          <div className="pt-4">
            <Link
              href="/login"
              className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200"
            >
              Log In to AssistDesk
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              New Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              required
              disabled={isLoading}
              className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60"
            />
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-slate-400 space-y-1">
            <p className="font-medium text-slate-300 mb-1">Password requirements:</p>
            {passwordRules.map((rule) => (
              <div key={rule.label} className="flex items-center gap-2">
                <span className={rule.met ? "text-emerald-400" : "text-slate-500"}>
                  {rule.met ? "✓" : "○"}
                </span>
                <span className={rule.met ? "text-slate-200" : "text-slate-400"}>
                  {rule.label}
                </span>
              </div>
            ))}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-2 block text-sm font-medium text-slate-300"
            >
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
              disabled={isLoading}
              className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              <p>{error}</p>
              {isExpired ? (
                <div className="mt-2">
                  <Link
                    href="/forgot-password"
                    className="font-medium underline hover:text-white"
                  >
                    Request a new password reset link &rarr;
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isLoading || !passwordValid || password !== confirmPassword}
            className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isLoading ? "Resetting Password..." : "Reset Password"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="page-shell pb-12">
      <SiteNavbar />
      <main className="section-wrap pt-10 md:pt-16">
        <Suspense
          fallback={
            <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-8 text-center text-slate-400">
              Loading...
            </div>
          }
        >
          <ResetPasswordContent />
        </Suspense>
      </main>
    </div>
  );
}
