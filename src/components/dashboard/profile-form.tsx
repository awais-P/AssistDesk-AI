"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type ProfileFormProps = {
  fullName: string;
  email: string;
  username: string;
  role: string;
  workspaceName: string;
};

export function ProfileForm({
  fullName,
  email,
  username,
  role,
  workspaceName,
}: ProfileFormProps) {
  const router = useRouter();
  const [nameValue, setNameValue] = useState(fullName);
  const [emailValue, setEmailValue] = useState(email);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to update profile right now.");
        setIsSaving(false);
        return;
      }

      setSuccess("Profile updated successfully.");
      router.refresh();
    } catch {
      setError("Something went wrong while saving your profile.");
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
            Update your account information for the dashboard workspace.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">Account Details</p>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Full Name
              </label>
              <input
                type="text"
                value={nameValue}
                onChange={(event) => setNameValue(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                type="email"
                value={emailValue}
                onChange={(event) => setEmailValue(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  disabled
                  className="w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-slate-400 outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Role
                </label>
                <input
                  type="text"
                  value={role}
                  disabled
                  className="w-full rounded-2xl border border-white/10 bg-[#111111] px-4 py-3 text-slate-400 outline-none"
                />
              </div>
            </div>

            {error ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {success}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black disabled:bg-neutral-400"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </section>

        <section className="rounded-[20px] border border-white/10 bg-[#0a0a0a] p-6">
          <p className="text-sm font-semibold text-slate-400">Workspace</p>
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">Workspace Name</p>
              <p className="mt-2 text-sm text-slate-400">{workspaceName}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-sm font-medium text-white">Profile Page Status</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This section is now real and editable instead of being a
                placeholder shell.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
