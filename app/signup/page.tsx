"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteNavbar } from "../../src/components/ui/site-navbar";
import { getEmailError, getPasswordRules } from "../../src/lib/form-validation";

const inputClass =
  "w-full rounded-2xl border bg-black px-4 py-3 text-white outline-none transition focus:border-white disabled:opacity-60";

type Field = "fullName" | "email" | "password" | "confirmPassword";

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState<Record<Field, boolean>>({
    fullName: false,
    email: false,
    password: false,
    confirmPassword: false,
  });
  const [error, setError] = useState("");
  const [accountExists, setAccountExists] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const passwordRules = getPasswordRules(password);
  const passwordValid = passwordRules.every((rule) => rule.met);
  const fieldErrors: Record<Field, string | null> = {
    fullName: fullName.trim() ? null : "Full name is required.",
    email: getEmailError(email),
    password: passwordValid ? null : "Your password doesn't meet the rules below yet.",
    confirmPassword:
      confirmPassword === password && confirmPassword.length > 0
        ? null
        : confirmPassword.length === 0
          ? "Please confirm your password."
          : "Passwords don't match.",
  };

  function markTouched(field: Field) {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  }

  function visibleError(field: Field) {
    return touched[field] ? fieldErrors[field] : null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    setTouched({ fullName: true, email: true, password: true, confirmPassword: true });

    if (Object.values(fieldErrors).some(Boolean)) {
      setError("Please fix the highlighted fields and try again.");
      setAccountExists(false);
      return;
    }

    setError("");
    setAccountExists(false);
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

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        redirectTo?: string;
      };

      if (!response.ok) {
        if (response.status === 409) {
          setAccountExists(true);
          setError("An account already exists for this email.");
        } else {
          setError(data.error ?? "Signup failed. Please try again in a moment.");
        }

        setIsLoading(false);
        return;
      }

      window.location.assign(data.redirectTo ?? "/setup");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setIsLoading(false);
    }
  }

  const fullNameError = visibleError("fullName");
  const emailError = visibleError("email");
  const confirmError = visibleError("confirmPassword");
  const showPasswordRuleErrors = touched.password || password.length > 0;

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
              Create your account and workspace, then follow a short setup to connect
              an inbox, an AI agent and a website chatbot.
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

              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
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
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    onBlur={() => markTouched("fullName")}
                    disabled={isLoading}
                    placeholder="Your full name"
                    aria-invalid={Boolean(fullNameError)}
                    aria-describedby={fullNameError ? "fullName-error" : undefined}
                    className={`${inputClass} ${fullNameError ? "border-red-500/50" : "border-white/10"}`}
                  />
                  {fullNameError ? (
                    <p id="fullName-error" className="mt-1.5 text-xs text-red-300">
                      {fullNameError}
                    </p>
                  ) : null}
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
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (accountExists) {
                        setAccountExists(false);
                        setError("");
                      }
                    }}
                    onBlur={() => markTouched("email")}
                    disabled={isLoading}
                    placeholder="you@company.com"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? "signupEmail-error" : undefined}
                    className={`${inputClass} ${emailError ? "border-red-500/50" : "border-white/10"}`}
                  />
                  {emailError ? (
                    <p id="signupEmail-error" className="mt-1.5 text-xs text-red-300">
                      {emailError}
                    </p>
                  ) : null}
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
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => markTouched("password")}
                    disabled={isLoading}
                    placeholder="Create a password"
                    aria-invalid={showPasswordRuleErrors && !passwordValid}
                    aria-describedby="signupPassword-rules"
                    className={`${inputClass} ${
                      showPasswordRuleErrors && !passwordValid
                        ? "border-red-500/50"
                        : "border-white/10"
                    }`}
                  />
                  <ul id="signupPassword-rules" className="mt-2 space-y-1 text-xs">
                    {passwordRules.map((rule) => (
                      <li
                        key={rule.label}
                        className={
                          rule.met
                            ? "text-emerald-300"
                            : showPasswordRuleErrors
                              ? "text-red-300"
                              : "text-slate-500"
                        }
                      >
                        <span aria-hidden="true">{rule.met ? "✓" : "•"}</span> {rule.label}
                        <span className="sr-only">{rule.met ? " (met)" : " (not met)"}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <label
                    htmlFor="signupConfirmPassword"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="signupConfirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      if (event.target.value.length >= password.length) {
                        markTouched("confirmPassword");
                      }
                    }}
                    onBlur={() => markTouched("confirmPassword")}
                    disabled={isLoading}
                    placeholder="Type your password again"
                    aria-invalid={Boolean(confirmError)}
                    aria-describedby={confirmError ? "signupConfirmPassword-error" : undefined}
                    className={`${inputClass} ${confirmError ? "border-red-500/50" : "border-white/10"}`}
                  />
                  {confirmError ? (
                    <p id="signupConfirmPassword-error" className="mt-1.5 text-xs text-red-300">
                      {confirmError}
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    {error}
                    {accountExists ? (
                      <>
                        {" "}
                        <Link href="/login" className="font-semibold text-white underline underline-offset-2">
                          Sign in instead
                        </Link>
                        .
                      </>
                    ) : null}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="pressable inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
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
