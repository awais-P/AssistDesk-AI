"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type AgentOption = {
  id: string;
  name: string;
};

type InboxEditorProps = {
  mode: "create" | "edit";
  inbox?: {
    id: string;
    name: string;
    emailPrefix: string;
    senderEmail: string | null;
    autoReplyEnabled: boolean;
    ticketPrefix: string;
    assignedAgentId: string | null;
    senderName: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpUser: string | null;
    smtpSecure: boolean;
    hasSmtpPassword: boolean;
  };
  agentOptions: AgentOption[];
  currentUserEmail: string;
};

type SenderMode = "default" | "custom";

type AvailabilityResult = {
  tone: "available" | "taken" | "error";
  message: string;
} | null;

const inputClassName =
  "w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none transition focus:border-white";

/** Initials of the inbox name ("Billing Support" → "BS"); a single word uses its first letters. */
function derivePrefix(name: string) {
  const words = name
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);

  if (words.length === 0) {
    return "";
  }

  if (words.length === 1) {
    return words[0].slice(0, 3);
  }

  return words
    .map((word) => word[0])
    .join("")
    .slice(0, 3);
}

function cleanEmailPrefix(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function InboxEditor({
  mode,
  inbox,
  agentOptions,
  currentUserEmail,
}: InboxEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(inbox?.name ?? "");
  const [emailPrefix, setEmailPrefix] = useState(inbox?.emailPrefix ?? "");
  const [ticketPrefix, setTicketPrefix] = useState(
    inbox?.ticketPrefix ?? derivePrefix(inbox?.name ?? ""),
  );
  // Existing inboxes keep their prefix so ticket numbers stay stable.
  const [ticketPrefixEdited, setTicketPrefixEdited] = useState(mode === "edit");
  // With the default sender the stored address is the inbox's own Reply-To, which is
  // not a useful starting point for a custom SMTP "From" address.
  const [senderEmail, setSenderEmail] = useState(
    inbox?.senderEmail && !inbox.senderEmail.endsWith("@assistdesk.ai")
      ? inbox.senderEmail
      : currentUserEmail,
  );
  const [assignedAgentId, setAssignedAgentId] = useState(
    inbox?.assignedAgentId ?? "",
  );
  const [senderMode, setSenderMode] = useState<SenderMode>(
    inbox?.smtpHost ? "custom" : "default",
  );
  const [senderName, setSenderName] = useState(inbox?.senderName ?? "");
  const [smtpHost, setSmtpHost] = useState(inbox?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(inbox?.smtpPort ?? 587));
  const [smtpUser, setSmtpUser] = useState(inbox?.smtpUser ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(
    inbox?.smtpHost ? inbox.smtpSecure : false,
  );
  const [availability, setAvailability] = useState<AvailabilityResult>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const inboxAddress = `${cleanEmailPrefix(emailPrefix) || "your-prefix"}@assistdesk.ai`;
  const hasStoredPassword = Boolean(inbox?.hasSmtpPassword && inbox.smtpHost);
  const isCustomSender = senderMode === "custom";

  async function checkAvailability() {
    setError("");
    setAvailability(null);

    if (!emailPrefix.trim()) {
      setAvailability({ tone: "error", message: "Enter an inbox address to check." });
      return;
    }

    setIsChecking(true);

    try {
      const response = await fetch(
        `/api/inboxes?emailPrefix=${encodeURIComponent(emailPrefix)}`,
      );
      const data = (await response.json().catch(() => ({}))) as {
        isAvailable?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || typeof data.isAvailable !== "boolean") {
        setAvailability({
          tone: "error",
          message: data.error ?? "Unable to check right now. Try again in a moment.",
        });
        return;
      }

      setAvailability({
        tone: data.isAvailable ? "available" : "taken",
        message:
          data.message ??
          (data.isAvailable ? "Available." : "This inbox address is already taken."),
      });
    } catch {
      setAvailability({
        tone: "error",
        message: "Could not reach AssistDesk. Check your connection and try again.",
      });
    } finally {
      setIsChecking(false);
    }
  }

  function handleSecureChange(checked: boolean) {
    setSmtpSecure(checked);

    // Keep the port in step with the common SSL (465) / STARTTLS (587) pairing.
    if (checked && smtpPort === "587") {
      setSmtpPort("465");
    } else if (!checked && smtpPort === "465") {
      setSmtpPort("587");
    }
  }

  function validate() {
    if (!name.trim()) {
      return "Give the inbox a name, like Support or Billing.";
    }

    if (!cleanEmailPrefix(emailPrefix)) {
      return "Choose an inbox email address, like support.";
    }

    if (!isCustomSender) {
      return "";
    }

    if (!smtpHost.trim()) {
      return "Enter your SMTP host (for example smtp.sendgrid.net), or switch to the default AssistDesk sender.";
    }

    const port = Number(smtpPort);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "SMTP port must be a number between 1 and 65535 — usually 587, or 465 for SSL/TLS.";
    }

    return "";
  }

  async function handleSave() {
    setError("");
    setSuccess("");

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch("/api/inboxes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: inbox?.id,
          name,
          emailPrefix,
          // The platform sender replies from its own address; Reply-To routes answers back to this inbox.
          senderEmail: isCustomSender ? senderEmail : inboxAddress,
          autoReplyEnabled: true,
          ticketPrefix: ticketPrefix || derivePrefix(name),
          assignedAgentId: assignedAgentId || null,
          senderName: senderName.trim(),
          smtpHost: isCustomSender ? smtpHost.trim() : "",
          smtpPort: isCustomSender ? Number(smtpPort) : undefined,
          smtpUser: isCustomSender ? smtpUser.trim() : "",
          smtpPassword: isCustomSender ? smtpPassword : "",
          smtpSecure: isCustomSender ? smtpSecure : undefined,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        inbox?: {
          id: string;
        };
      };

      if (!response.ok || !data.inbox) {
        setError(data.error ?? "Unable to save the inbox right now. Try again in a moment.");
        return;
      }

      setSmtpPassword("");
      setSuccess(
        mode === "edit"
          ? isCustomSender
            ? "Inbox updated. SMTP connection verified."
            : "Inbox updated successfully."
          : "Inbox created successfully.",
      );

      if (mode === "create") {
        router.push(`/dashboard/inboxes/${data.inbox.id}`);
      } else {
        router.refresh();
      }
    } catch {
      setError("Could not reach AssistDesk. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!inbox?.id) {
      router.push("/dashboard/inboxes");
      return;
    }

    const shouldDelete = window.confirm(
      "Delete this inbox? This action cannot be undone.",
    );

    if (!shouldDelete) {
      return;
    }

    setError("");
    setSuccess("");
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/inboxes/${inbox.id}`, {
        method: "DELETE",
      });

      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Unable to delete the inbox.");
        return;
      }

      router.push("/dashboard/inboxes");
    } catch {
      setError("Something went wrong while deleting the inbox.");
    } finally {
      setIsDeleting(false);
    }
  }

  const saveLabel = isSaving
    ? isCustomSender
      ? "Testing connection…"
      : "Saving..."
    : "Save Changes";

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="mx-auto max-w-[760px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/inboxes"
                aria-label="Back to inboxes"
                className="pressable inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-sm text-white transition hover:bg-[#1a1a1a]"
              >
                ←
              </Link>
              <div>
                <h1 className="heading-font text-[2rem] font-bold leading-none text-white">
                  Inbox Configuration
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  Configure your helpdesk inbox settings with a dedicated compact
                  editor page.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
          >
            {saveLabel}
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="inbox-name"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Inbox Name
                </label>
                <input
                  id="inbox-name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setName(nextName);
                    if (!ticketPrefixEdited) {
                      setTicketPrefix(derivePrefix(nextName));
                    }
                  }}
                  className={inputClassName}
                />
              </div>

              <div>
                <label
                  htmlFor="inbox-email-prefix"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Email Address
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    id="inbox-email-prefix"
                    type="text"
                    value={emailPrefix}
                    onChange={(event) => {
                      setEmailPrefix(event.target.value);
                      setAvailability(null);
                    }}
                    aria-describedby="inbox-email-availability"
                    className={inputClassName}
                  />
                  <div className="inline-flex items-center rounded-xl border border-white/10 bg-[#151515] px-4 text-sm text-slate-400">
                    @assistdesk.ai
                  </div>
                  <button
                    type="button"
                    disabled={isChecking || !emailPrefix.trim()}
                    onClick={checkAvailability}
                    className="pressable inline-flex items-center justify-center rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#1c1c1c] disabled:opacity-60"
                  >
                    {isChecking ? "Checking..." : "Check"}
                  </button>
                </div>
                <p
                  id="inbox-email-availability"
                  role="status"
                  className={`mt-2 text-xs ${
                    availability?.tone === "available"
                      ? "text-emerald-300"
                      : availability?.tone === "taken"
                        ? "text-red-300"
                        : availability?.tone === "error"
                          ? "text-amber-200"
                          : "text-slate-400"
                  }`}
                >
                  {isChecking
                    ? "Checking availability..."
                    : availability
                      ? availability.message
                      : null}
                </p>
              </div>

              <div>
                <label
                  htmlFor="inbox-ticket-prefix"
                  className="mb-2 block text-sm font-medium text-slate-300"
                >
                  Ticket Prefix
                </label>
                <input
                  id="inbox-ticket-prefix"
                  type="text"
                  value={ticketPrefix}
                  maxLength={10}
                  onChange={(event) => {
                    const nextPrefix = event.target.value.toUpperCase();
                    setTicketPrefix(nextPrefix);
                    // Clearing the field hands it back to auto-derivation from the name.
                    setTicketPrefixEdited(nextPrefix !== "");
                  }}
                  className={inputClassName}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Tickets are numbered like {ticketPrefix || derivePrefix(name) || "AD"}-1024.
                  {ticketPrefixEdited ? "" : " Generated from the inbox name until you edit it."}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">Email Sender</p>
            <p className="mt-1 text-sm text-slate-400">
              Choose how replies to customers are sent from this inbox.
            </p>

            <fieldset className="mt-4 space-y-3">
              <legend className="sr-only">Email sender</legend>
              <label
                htmlFor="sender-mode-default"
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                  !isCustomSender
                    ? "border-white/40 bg-[#151515]"
                    : "border-white/10 bg-[#111111] hover:bg-[#151515]"
                }`}
              >
                <input
                  id="sender-mode-default"
                  type="radio"
                  name="sender-mode"
                  value="default"
                  checked={!isCustomSender}
                  onChange={() => setSenderMode("default")}
                  className="mt-1 h-4 w-4 accent-white"
                />
                <span>
                  <span className="block text-sm font-medium text-white">
                    Default AssistDesk sender
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    Replies are sent from our platform address, with Reply-To set
                    to {inboxAddress} so customer answers come back to this inbox.
                  </span>
                </span>
              </label>

              <label
                htmlFor="sender-mode-custom"
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                  isCustomSender
                    ? "border-white/40 bg-[#151515]"
                    : "border-white/10 bg-[#111111] hover:bg-[#151515]"
                }`}
              >
                <input
                  id="sender-mode-custom"
                  type="radio"
                  name="sender-mode"
                  value="custom"
                  checked={isCustomSender}
                  onChange={() => setSenderMode("custom")}
                  className="mt-1 h-4 w-4 accent-white"
                />
                <span>
                  <span className="block text-sm font-medium text-white">Custom SMTP</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    Send from your own domain through SendGrid, Mailgun, Gmail,
                    Outlook or any SMTP server.
                  </span>
                </span>
              </label>
            </fieldset>

            {isCustomSender ? (
              <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-[#111111] p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="inbox-sender-name"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Sender Name
                    </label>
                    <input
                      id="inbox-sender-name"
                      type="text"
                      value={senderName}
                      maxLength={80}
                      onChange={(event) => setSenderName(event.target.value)}
                      placeholder={name || "Acme Support"}
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label
                        htmlFor="inbox-sender-email"
                        className="block text-sm font-medium text-slate-300"
                      >
                        Sender Email
                      </label>
                      <button
                        type="button"
                        onClick={() => setSenderEmail(currentUserEmail)}
                        className="pressable rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-400 transition hover:text-white"
                      >
                        Use workspace email
                      </button>
                    </div>
                    <input
                      id="inbox-sender-email"
                      type="email"
                      value={senderEmail}
                      onChange={(event) => setSenderEmail(event.target.value)}
                      placeholder="support@yourcompany.com"
                      className={inputClassName}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_140px]">
                  <div>
                    <label
                      htmlFor="inbox-smtp-host"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      SMTP Host
                    </label>
                    <input
                      id="inbox-smtp-host"
                      type="text"
                      autoComplete="off"
                      value={smtpHost}
                      onChange={(event) => setSmtpHost(event.target.value)}
                      placeholder="smtp.sendgrid.net"
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="inbox-smtp-port"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Port
                    </label>
                    <input
                      id="inbox-smtp-port"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={smtpPort}
                      onChange={(event) => setSmtpPort(event.target.value)}
                      className={inputClassName}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="inbox-smtp-user"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Username
                    </label>
                    <input
                      id="inbox-smtp-user"
                      type="text"
                      autoComplete="off"
                      value={smtpUser}
                      onChange={(event) => setSmtpUser(event.target.value)}
                      placeholder="apikey or you@yourcompany.com"
                      className={inputClassName}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="inbox-smtp-password"
                      className="mb-2 block text-sm font-medium text-slate-300"
                    >
                      Password
                    </label>
                    <input
                      id="inbox-smtp-password"
                      type="password"
                      autoComplete="new-password"
                      value={smtpPassword}
                      onChange={(event) => setSmtpPassword(event.target.value)}
                      placeholder={
                        hasStoredPassword ? "Saved — leave blank to keep" : "SMTP password or API key"
                      }
                      className={inputClassName}
                    />
                  </div>
                </div>

                <label
                  htmlFor="inbox-smtp-secure"
                  className="flex items-center gap-3 text-sm font-medium text-white"
                >
                  <input
                    id="inbox-smtp-secure"
                    type="checkbox"
                    checked={smtpSecure}
                    onChange={(event) => handleSecureChange(event.target.checked)}
                    className="h-4 w-4 accent-white"
                  />
                  Use SSL/TLS (port 465)
                </label>

                <p className="text-xs leading-5 text-slate-500">
                  Gmail and Outlook need an app password (not your normal login
                  password) with two-step verification turned on. AssistDesk tests
                  the connection when you save, which can take a few seconds.
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
            <p className="text-base font-semibold text-white">AI Agent</p>
            <p className="mt-1 text-sm text-slate-400">
              Assign an AI agent to automatically handle tickets in this inbox.
            </p>

            <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-[#111111] p-4">
              <label
                htmlFor="inbox-agent"
                className="mb-2 block text-sm font-medium text-slate-300"
              >
                Select an AI Agent
              </label>
              <select
                id="inbox-agent"
                value={assignedAgentId}
                onChange={(event) => setAssignedAgentId(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#151515] px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">No Agent Assigned</option>
                {agentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {error}
            </p>
          ) : null}

          {success ? (
            <p
              role="status"
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
            >
              {success}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={isDeleting || isSaving}
              onClick={handleDelete}
              className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a] disabled:opacity-60"
            >
              {mode === "edit"
                ? isDeleting
                  ? "Deleting..."
                  : "Delete Inbox"
                : "Cancel"}
            </button>

            <div className="flex gap-3">
              <Link
                href="/dashboard/inboxes"
                className="pressable inline-flex items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1a1a1a]"
              >
                Back to Inboxes
              </Link>
              <button
                type="button"
                disabled={isSaving || isDeleting}
                onClick={handleSave}
                className="pressable inline-flex items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:bg-neutral-400"
              >
                {saveLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
