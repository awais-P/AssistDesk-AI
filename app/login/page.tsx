"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleResendVerification() {
    if (resending || !email) return;
    setResending(true);
    setResendStatus("");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.ok) {
        setResendStatus(data.message || "Confirmation email sent! Check your inbox.");
      } else {
        setResendStatus(data.error || "Failed to resend confirmation email.");
      }
    } catch {
      setResendStatus("Failed to send request. Check your connection.");
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!email.trim() || !password) {
      setError("Enter your email (or username) and password to continue.");
      return;
    }

    setError("");
    setSuccessMessage("");
    setUnverified(false);
    setResendStatus("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        redirectTo?: string;
        unverified?: boolean;
        email?: string;
      };

      if (!response.ok) {
        if (response.status === 403 && data.unverified) {
          setUnverified(true);
          setError(
            data.error ?? "Your email is not verified. Please check your inbox for the confirmation email before logging in.",
          );
        } else if (response.status === 401) {
          setError(
            "That email/username and password don't match. Check for typos and try again.",
          );
        } else if (response.status === 429) {
          setError(
            data.error ??
              "Too many sign-in attempts. Please wait a few minutes before trying again.",
          );
        } else {
          setError(data.error ?? "Login failed. Please try again in a moment.");
        }

        setIsLoading(false);
        return;
      }

      window.location.assign(data.redirectTo ?? "/dashboard");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setIsLoading(false);
    }
  }

  return (
    <div className="page-shell pb-12">
      <SiteNavbar />

      <main className="section-wrap pt-8 md:pt-12">
        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <p className="text-sm font-semibold text-slate-400">
              Welcome back
            </p>
            <h1 className="heading-font mt-3 text-4xl font-bold text-white">
              Log in to AssistDesk
            </h1>
            <p className="mt-4 max-w-md text-sm leading-7 text-slate-400">
              Sign in with your email or username to open your support workspace.
            </p>

            <div className="mt-8 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">
                  AI-Powered Support Platform
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Manage tickets, chatbots, AI agents, and knowledge bases all in one unified dashboard. Deploy intelligent customer support without complexity.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6">
                <p className="text-sm font-semibold text-slate-400">
                  Account Login
                </p>
                <h2 className="heading-font mt-2 text-3xl font-bold text-white">
                  Continue to your workspace
                </h2>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                <div>
                  <label
                    htmlFor="email"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Username or Email
                  </label>
                  <input
                    id="email"
                    type="text"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    autoComplete="username"
                    disabled={isLoading}
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Your password"
                    autoComplete="current-password"
                    disabled={isLoading}
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60"
                  />
                </div>

                {successMessage ? (
                  <p
                    role="status"
                    className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
                  >
                    {successMessage}
                  </p>
                ) : null}

                {error ? (
                  <div
                    role="alert"
                    className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    <p>{error}</p>
                    {unverified ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={handleResendVerification}
                          disabled={resending}
                          className="font-medium underline hover:text-white disabled:opacity-50"
                        >
                          {resending ? "Sending..." : "Resend confirmation email"}
                        </button>
                        {resendStatus ? (
                          <p className="mt-1 text-xs text-amber-200">{resendStatus}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
                >
                  {isLoading ? "Logging In..." : "Log In"}
                </button>
              </form>

              <p className="mt-5 text-sm text-slate-400">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="font-semibold text-white">
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
