"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ fullName, email, password }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Signup failed. Please try again.");
        setIsLoading(false);
        return;
      }

      window.location.assign("/dashboard/tickets");
    } catch {
      setError("Something went wrong during signup. Please try again.");
      setIsLoading(false);
    }
  }

  return (
    <div className="page-shell pb-12">
      <SiteNavbar />

      <main className="section-wrap pt-6 md:pt-8">
        <section className="grid gap-6 md:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <p className="text-sm font-semibold text-slate-400">
              Get started
            </p>
            <h1 className="heading-font mt-3 text-4xl font-bold text-white">
              Create your AssistDesk account
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-slate-400">
              Register a real account, create your own workspace, and continue
              directly into the dashboard with an authenticated session.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="heading-font text-2xl font-bold text-white">
                  Step 1
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Create your account and workspace automatically.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="heading-font text-2xl font-bold text-white">
                  Step 2
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Enter the dashboard and continue with inbox and agent setup.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6">
                <p className="text-sm font-semibold text-slate-400">
                  Sign Up
                </p>
                <h2 className="heading-font mt-2 text-3xl font-bold text-white">
                  Start building your support workspace
                </h2>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label
                    htmlFor="fullName"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Muhammad Awais"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signupEmail"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Email Address
                  </label>
                  <input
                    id="signupEmail"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signupPassword"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Password
                  </label>
                  <input
                    id="signupPassword"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Create a password"
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
                  {isLoading ? "Creating Account..." : "Create Account"}
                </button>
              </form>

              <p className="mt-5 text-sm text-slate-400">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-white">
                  Log in
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
