"use client";

import { useState } from "react";

type SettingsWorkspaceProps = {
  initialWorkspace: {
    name: string;
    supportEmail: string;
  };
  initialSettings: {
    timezone: string;
    theme: string;
    supportSignature: string;
  };
};

export function SettingsWorkspace({
  initialWorkspace,
  initialSettings,
}: SettingsWorkspaceProps) {
  const [workspaceName, setWorkspaceName] = useState(initialWorkspace.name);
  const [supportEmail, setSupportEmail] = useState(initialWorkspace.supportEmail);
  const [timezone, setTimezone] = useState(initialSettings.timezone);
  const [theme, setTheme] = useState(initialSettings.theme);
  const [supportSignature, setSupportSignature] = useState(
    initialSettings.supportSignature,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceName,
          supportEmail,
          timezone,
          theme,
          supportSignature,
        }),
      });

      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to save settings.");
        setIsSaving(false);
        return;
      }

      setSuccess("Settings saved successfully.");
    } catch {
      setError("Something went wrong while saving settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="max-w-[900px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
              Settings
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Keep workspace settings simple for now while preserving a clean,
              consistent configuration screen.
            </p>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void handleSave()}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {error ? (
          <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {success}
          </p>
        ) : null}

        <div className="mt-6 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">
              Workspace Basics
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-white">
                  Workspace Name
                </label>
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-white">
                  Support Email
                </label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(event) => setSupportEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">
              Preferences
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-white">
                  Timezone
                </label>
                <input
                  type="text"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-white">
                  Theme
                </label>
                <select
                  value={theme}
                  onChange={(event) => setTheme(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-white outline-none"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">
              Support Signature
            </p>
            <div className="mt-4">
              <textarea
                value={supportSignature}
                onChange={(event) => setSupportSignature(event.target.value)}
                className="min-h-[180px] w-full rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-white"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
