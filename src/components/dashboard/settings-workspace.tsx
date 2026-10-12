"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getEmailError } from "@/src/lib/form-validation";

const COMMON_TIMEZONES = [
  "Asia/Karachi",
  "UTC",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
];

type SettingsWorkspaceProps = {
  canEdit: boolean;
  initialWorkspace: {
    name: string;
    supportEmail: string;
  };
  initialSettings: {
    timezone: string;
    supportSignature: string;
    crossChannelMemory: boolean;
  };
  workspaceInfo: {
    slug: string;
    createdLabel: string;
    role: string;
    roleDescription: string;
  };
};

const inputClass =
  "w-full rounded-xl border bg-[#111111] px-4 py-3 text-sm text-white outline-none transition focus:border-white disabled:cursor-not-allowed disabled:text-slate-400";

function formatRole(role: string) {
  return `${role.charAt(0)}${role.slice(1).toLowerCase()}`;
}

export function SettingsWorkspace({
  canEdit,
  initialWorkspace,
  initialSettings,
  workspaceInfo,
}: SettingsWorkspaceProps) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState(initialWorkspace.name);
  const [supportEmail, setSupportEmail] = useState(initialWorkspace.supportEmail);
  const [timezone, setTimezone] = useState(initialSettings.timezone);
  const [supportSignature, setSupportSignature] = useState(
    initialSettings.supportSignature,
  );
  const [crossChannelMemory, setCrossChannelMemory] = useState(
    initialSettings.crossChannelMemory,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const nameError = workspaceName.trim() ? null : "Workspace name is required.";
  const emailError = getEmailError(supportEmail);
  const hasErrors = Boolean(nameError || emailError);
  const timezoneOptions = COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEdit || hasErrors) {
      return;
    }

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
          supportSignature,
          crossChannelMemory,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(
          data.error ??
            "Unable to save settings. Check the fields above and try again.",
        );
        return;
      }

      setSuccess("Settings saved successfully.");
      router.refresh();
    } catch {
      setError("Couldn't reach the server while saving. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 md:px-6">
      <form className="max-w-[900px]" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
              Settings
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Workspace details, support contact and preferences shared by your whole
              team.
            </p>
          </div>

          {canEdit ? (
            <button
              type="submit"
              disabled={isSaving || hasErrors}
              className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          ) : null}
        </div>

        {!canEdit ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            Only admins can change workspace settings. Ask a workspace admin or the
            owner if something here needs updating.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        ) : null}

        {success ? (
          <p
            role="status"
            className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            {success}
          </p>
        ) : null}

        <div className="mt-6 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">Workspace</p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-400">Workspace name</dt>
                <dd className="mt-1 break-words text-white">{initialWorkspace.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Slug</dt>
                <dd className="mt-1 break-all font-mono text-xs text-white">
                  {workspaceInfo.slug}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Created</dt>
                <dd className="mt-1 text-white">{workspaceInfo.createdLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Your role</dt>
                <dd className="mt-1 text-white">{formatRole(workspaceInfo.role)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              {workspaceInfo.roleDescription}
            </p>
          </section>

          <fieldset disabled={!canEdit || isSaving} className="min-w-0 space-y-5">
            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">Workspace Basics</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="settings-workspace-name"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Workspace Name
                  </label>
                  <input
                    id="settings-workspace-name"
                    type="text"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "settings-workspace-name-error" : undefined}
                    className={`${inputClass} ${nameError ? "border-red-500/50" : "border-white/10"}`}
                  />
                  {nameError && canEdit ? (
                    <p id="settings-workspace-name-error" className="mt-1.5 text-xs text-red-300">
                      {nameError}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label
                    htmlFor="settings-support-email"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Support Email
                  </label>
                  <input
                    id="settings-support-email"
                    type="email"
                    value={supportEmail}
                    onChange={(event) => setSupportEmail(event.target.value)}
                    aria-invalid={Boolean(emailError)}
                    aria-describedby="settings-support-email-hint"
                    className={`${inputClass} ${emailError ? "border-red-500/50" : "border-white/10"}`}
                  />
                  <p
                    id="settings-support-email-hint"
                    className={`mt-1.5 text-xs ${emailError && canEdit ? "text-red-300" : "text-slate-500"}`}
                  >
                    {emailError && canEdit
                      ? emailError
                      : "The public contact address for your support team."}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">Preferences</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="settings-timezone"
                    className="mb-2 block text-sm font-medium text-white"
                  >
                    Timezone
                  </label>
                  <select
                    id="settings-timezone"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className={`${inputClass} border-white/10`}
                  >
                    {timezoneOptions.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-base font-semibold text-white">Customer Memory</p>
              <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4">
                <div>
                  <p id="settings-cross-channel-memory-label" className="text-sm font-semibold text-white">
                    Cross-channel memory
                  </p>
                  <p id="settings-cross-channel-memory-hint" className="mt-1 text-sm text-slate-400">
                    When on, the assistant recognises returning customers across Website,
                    WhatsApp, Slack and Email and uses what they said before (personal details
                    are masked and never volunteered). Turn off to keep every channel separate.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={crossChannelMemory}
                  aria-labelledby="settings-cross-channel-memory-label"
                  aria-describedby="settings-cross-channel-memory-hint"
                  onClick={() => setCrossChannelMemory((current) => !current)}
                  className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    crossChannelMemory ? "bg-emerald-400" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${
                      crossChannelMemory ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
              <label
                htmlFor="settings-signature"
                className="block text-base font-semibold text-white"
              >
                Support Signature
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Added to the end of email replies sent from this workspace.
              </p>
              <div className="mt-4">
                <textarea
                  id="settings-signature"
                  value={supportSignature}
                  onChange={(event) => setSupportSignature(event.target.value)}
                  className={`${inputClass} min-h-[180px] border-white/10 leading-6`}
                />
              </div>
            </section>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
