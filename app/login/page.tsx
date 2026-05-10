"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
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

      const data = (await response.json()) as {
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok) {
        setError(data.error ?? "Login failed. Please try again.");
        setIsLoading(false);
        return;
      }

      window.location.assign(data.redirectTo ?? "/dashboard/tickets");
    } catch {
      setError("Something went wrong during login. Please try again.");
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
              Sign in with your registered account or use the demo admin user to
              access the dashboard shell.
            </p>

            <div className="mt-8 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-sm font-medium text-white">
                  Temporary demo login
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Username: <span className="text-white">admin</span>
                </p>
                <p className="text-sm leading-6 text-slate-400">
                  Password: <span className="text-white">admin</span>
                </p>
              </div>

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

              <form className="space-y-4" onSubmit={handleSubmit}>
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
                    placeholder="admin"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
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
                    placeholder="admin"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                {error ? (
                  <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
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
