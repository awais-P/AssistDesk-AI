"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setError(data.error ?? "Failed to request password reset. Please try again.");
        setIsLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="page-shell pb-12">
      <SiteNavbar />

      <main className="section-wrap pt-10 md:pt-16">
        <div className="mx-auto w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
          <div className="mb-6">
            <Link
              href="/login"
              className="mb-4 inline-flex items-center text-xs font-medium text-slate-400 hover:text-white transition"
            >
              &larr; Back to login
            </Link>
            <h1 className="heading-font text-3xl font-bold text-white">
              Forgot password?
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Enter your account&apos;s email address and we&apos;ll send you a link to reset your password.
            </p>
          </div>

          {success ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                <p className="font-semibold text-emerald-100">Check your inbox</p>
                <p className="mt-1 text-slate-300">
                  If an account exists for <span className="font-semibold text-white">{email}</span>, you will receive an email with instructions to reset your password within a few minutes.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <Link
                  href="/login"
                  className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200"
                >
                  Return to Log In
                </Link>
                <button
                  type="button"
                  onClick={() => setSuccess(false)}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white transition"
                >
                  Send another link
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60"
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
              >
                {isLoading ? "Sending Link..." : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
