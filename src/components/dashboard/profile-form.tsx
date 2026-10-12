"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEmailError, getPasswordRules } from "@/src/lib/form-validation";

type ProfileFormProps = {
  fullName: string;
  email: string;
  username: string;
  role: string;
  roleDescription: string;
  workspaceName: string;
  mustChangePassword: boolean;
  focusPasswordCard: boolean;
};

const inputClass =
  "w-full rounded-2xl border bg-black px-4 py-3 text-white outline-none transition focus:border-white";

function formatRole(role: string) {
  return `${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}

function ChangePasswordCard({
  mustChangePassword,
  highlight,
}: {
  mustChangePassword: boolean;
  highlight: boolean;
}) {
  const router = useRouter();
  const cardRef = useRef<HTMLElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const rules = getPasswordRules(newPassword);
  const rulesMet = rules.every((rule) => rule.met);
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    currentPassword.length > 0 && rulesMet && confirmPassword === newPassword && !isSaving;

  useEffect(() => {
    if (!highlight) {
      return;
    }

    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    currentPasswordRef.current?.focus({ preventScroll: true });
  }, [highlight]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/profile/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to change your password right now. Please try again.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(
        "Password changed. For your security, you were signed out on all other devices.",
      );
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      ref={cardRef}
      id="change-password"
      aria-labelledby="change-password-title"
      className={`rounded-[20px] border bg-[#0a0a0a] p-6 transition ${
        highlight ? "border-amber-500/40 ring-2 ring-amber-500/20" : "border-white/10"
      }`}
    >
      <h2 id="change-password-title" className="text-sm font-semibold text-slate-400">
        Change Password
      </h2>

      {mustChangePassword ? (
        <p className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          You&apos;re signed in with a temporary password. Enter it below as your current
          password, then choose one only you know.
        </p>
      ) : null}

      <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            htmlFor="current-password"
            className="mb-2 block text-sm font-medium text-slate-300"
          >
            Current Password
          </label>
          <input
            ref={currentPasswordRef}
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={`${inputClass} border-white/10`}
          />
        </div>

        <div>
          <label htmlFor="new-password" className="mb-2 block text-sm font-medium text-slate-300">
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={newPassword.length > 0 && !rulesMet}
            aria-describedby="new-password-rules"
            className={`${inputClass} ${
              newPassword.length > 0 && !rulesMet ? "border-red-500/50" : "border-white/10"
            }`}
          />
          <ul id="new-password-rules" className="mt-2 space-y-1 text-xs">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={
                  rule.met
                    ? "text-emerald-300"
                    : newPassword.length > 0
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
            htmlFor="confirm-password"
            className="mb-2 block text-sm font-medium text-slate-300"
          >
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={confirmMismatch}
            aria-describedby={confirmMismatch ? "confirm-password-error" : undefined}
            className={`${inputClass} ${confirmMismatch ? "border-red-500/50" : "border-white/10"}`}
          />
          {confirmMismatch ? (
            <p id="confirm-password-error" className="mt-1.5 text-xs text-red-300">
              Passwords don&apos;t match yet.
            </p>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            role="status"
            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            {success}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="pressable inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          {isSaving ? "Updating..." : "Update Password"}
        </button>
      </form>
    </section>
  );
}

export function ProfileForm({
  fullName,
  email,
  username,
  role,
  roleDescription,
  workspaceName,
  mustChangePassword,
  focusPasswordCard,
}: ProfileFormProps) {
  const router = useRouter();
  const [nameValue, setNameValue] = useState(fullName);
  const [emailValue, setEmailValue] = useState(email);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const nameError = nameValue.trim() ? null : "Full name is required.";
  const emailError = getEmailError(emailValue);
  const hasErrors = Boolean(nameError || emailError);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (hasErrors) {
      return;
    }

    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: nameValue,
          email: emailValue,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to update your profile right now. Please try again.");
        return;
      }

      setSuccess("Profile updated successfully.");
      router.refresh();
    } catch {
      setError("Couldn't reach the server while saving. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">
            Profile
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Manage your personal details and sign-in password.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
            <h2 className="text-sm font-semibold text-slate-400">Account Details</h2>

            <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label
                  htmlFor="profile-full-name"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Full Name
                </label>
                <input
                  id="profile-full-name"
                  type="text"
                  autoComplete="name"
                  value={nameValue}
                  onChange={(event) => setNameValue(event.target.value)}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "profile-full-name-error" : undefined}
                  className={`${inputClass} ${nameError ? "border-red-500/50" : "border-white/10"}`}
                />
                {nameError ? (
                  <p id="profile-full-name-error" className="mt-1.5 text-xs text-red-300">
                    {nameError}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="profile-email"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Email
                </label>
                <input
                  id="profile-email"
                  type="email"
                  autoComplete="email"
                  value={emailValue}
                  onChange={(event) => setEmailValue(event.target.value)}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "profile-email-error" : undefined}
                  className={`${inputClass} ${emailError ? "border-red-500/50" : "border-white/10"}`}
                />
                {emailError ? (
                  <p id="profile-email-error" className="mt-1.5 text-xs text-red-300">
                    {emailError}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="profile-username"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Username
                  </label>
                  <input
                    id="profile-username"
                    type="text"
                    value={username}
                    disabled
                    className="w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-slate-400 outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-role"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Role
                  </label>
                  <input
                    id="profile-role"
                    type="text"
                    value={formatRole(role)}
                    disabled
                    className="w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-slate-400 outline-none"
                  />
                </div>
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  {error}
                </p>
              ) : null}

              {success ? (
                <p
                  role="status"
                  className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
                >
                  {success}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSaving || hasErrors}
                className="pressable inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </section>

          <ChangePasswordCard
            mustChangePassword={mustChangePassword}
            highlight={focusPasswordCard || mustChangePassword}
          />
        </div>

        <section className="h-fit rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <h2 className="text-sm font-semibold text-slate-400">Workspace</h2>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">Workspace Name</p>
              <p className="mt-2 text-sm text-slate-400">{workspaceName}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">
                Your Access: {formatRole(role)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-400">{roleDescription}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">Security</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Changing your password signs you out everywhere else. If you think
                someone else has access to your account, change it now.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
