"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { isValidEmail } from "@/src/lib/form-validation";

/**
 * Module 8 lead settings: team notifications for new leads (FE-3), automatic capture
 * (FE-2) and outgoing, signed webhooks with a delivery log (FE-4, SRS CI-3).
 */

type LeadSettings = {
  notifyEmails: string[];
  slackWebhookUrl: string | null;
  slackConfigured: boolean;
  autoCaptureLeads: boolean;
  emailConfigured: boolean;
};

type WebhookEndpoint = {
  id: string;
  name: string;
  url: string;
  secretPreview: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  stats: { success: number; failed: number; pending: number };
};

type DeliveryStatus = "PENDING" | "RETRYING" | "SUCCESS" | "FAILED";

type WebhookDelivery = {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: unknown;
  lead: { id: string; name: string | null; email: string | null } | null;
};

type Notice = { tone: "success" | "error"; text: string } | null;

type TestResult = { channel: string; ok: boolean; detail: string };

type EndpointTestResult = {
  ok: boolean;
  status: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
};

const DEFAULT_EVENTS = ["lead.created", "lead.updated", "lead.status_changed"];
const MAX_NOTIFY_EMAILS = 10;
const MAX_ATTEMPTS = 4;
const SLACK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;

const eventLabels: Record<string, string> = {
  "lead.created": "New lead",
  "lead.updated": "Lead updated",
  "lead.status_changed": "Status changed",
  "webhook.test": "Test",
};

const inputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-[#111111] px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-white disabled:cursor-not-allowed disabled:text-slate-500";

const primaryButtonClass =
  "pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-[#050505] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-400";

const secondaryButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-3 text-xs font-semibold text-white transition hover:bg-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60";

const dangerButtonClass =
  "pressable inline-flex h-9 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60";

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// rawBody must be the exact request body string (not re-serialised JSON).
export function verifyAssistDesk(rawBody, header, secret) {
  const parts = Object.fromEntries(
    (header ?? "").split(",").map((part) => part.trim().split("=")),
  );
  const timestamp = Number(parts.t);

  // Reject old or replayed requests (5 minute window).
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest();
  const received = Buffer.from(parts.v1 ?? "", "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Express example:
// app.post("/assistdesk", express.raw({ type: "application/json" }), (req, res) => {
//   const ok = verifyAssistDesk(
//     req.body.toString("utf8"),
//     req.get("X-AssistDesk-Signature"),
//     process.env.ASSISTDESK_WEBHOOK_SECRET,
//   );
//   if (!ok) return res.sendStatus(401);
//   res.sendStatus(200); // reply fast, then process
//   // Skip it if you have already handled req.get("X-AssistDesk-Delivery").
// });`;

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function prettyBody(value: string | null) {
  if (!value) {
    return "";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

async function readJson<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) {
    return null;
  }

  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${
        notice.tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
      }`}
    >
      {notice.text}
    </p>
  );
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-white">{title}</p>
          {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-emerald-400" : "bg-white/10"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-[#050505] transition ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="mr-1.5 h-3.5 w-3.5 animate-spin" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function deliveryStatusClass(status: DeliveryStatus) {
  if (status === "SUCCESS") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "FAILED") {
    return "border-red-500/20 bg-red-500/10 text-red-200";
  }

  return "border-amber-500/20 bg-amber-500/10 text-amber-200";
}

const deliveryStatusLabels: Record<DeliveryStatus, string> = {
  PENDING: "Pending",
  RETRYING: "Retrying",
  SUCCESS: "Delivered",
  FAILED: "Failed",
};

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

function EmailChipsInput({
  emails,
  onChange,
  disabled,
}: {
  emails: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function addEmails(raw: string) {
    const candidates = raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (candidates.length === 0) {
      return;
    }

    const invalid = candidates.filter((email) => !isValidEmail(email));
    const valid = candidates.filter((email) => isValidEmail(email));
    const next = [...new Set([...emails, ...valid])];

    if (next.length > MAX_NOTIFY_EMAILS) {
      setError(`Up to ${MAX_NOTIFY_EMAILS} notification emails.`);
      onChange(next.slice(0, MAX_NOTIFY_EMAILS));
    } else {
      setError(invalid.length > 0 ? `Not a valid email: ${invalid.join(", ")}` : "");
      onChange(next);
    }

    setDraft(invalid.join(", "));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      addEmails(draft);
    } else if (event.key === "Backspace" && !draft && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  }

  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#111111] px-3 py-2 focus-within:border-white">
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs text-slate-100"
          >
            {email}
            {disabled ? null : (
              <button
                type="button"
                onClick={() => onChange(emails.filter((item) => item !== email))}
                className="text-slate-400 transition hover:text-red-300"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {disabled ? (
          emails.length === 0 ? <span className="text-sm text-slate-500">No recipients</span> : null
        ) : (
          <input
            id="lead-notify-emails"
            type="email"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => addEmails(draft)}
            placeholder={emails.length >= MAX_NOTIFY_EMAILS ? "" : "sales@yourcompany.com"}
            disabled={emails.length >= MAX_NOTIFY_EMAILS}
            className="h-7 min-w-[200px] flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
        )}
      </div>
      <p className={`mt-1.5 text-xs ${error ? "text-red-300" : "text-slate-500"}`}>
        {error || `Press Enter after each address. Up to ${MAX_NOTIFY_EMAILS}.`}
      </p>
    </div>
  );
}

function NotificationsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<LeadSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [slackUrl, setSlackUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingSlack, setIsRemovingSlack] = useState(false);
  const [isTogglingAuto, setIsTogglingAuto] = useState(false);
  const [autoNotice, setAutoNotice] = useState<Notice>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [testError, setTestError] = useState("");

  const applySettings = useCallback((next: LeadSettings) => {
    setSettings(next);
    setEmails(next.notifyEmails);
  }, []);

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const response = await fetch("/api/leads/settings", { cache: "no-store" });
      const data = await readJson<{ settings?: LeadSettings }>(response);

      if (!response.ok || !data.settings) {
        setLoadError(data.error ?? "Couldn't load the lead settings.");
        return;
      }

      applySettings(data.settings);
    } catch {
      setLoadError("Couldn't load the lead settings. Check your connection.");
    }
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    const response = await fetch("/api/leads/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson<{ settings?: LeadSettings }>(response);

    if (!response.ok || !data.settings) {
      throw new Error(data.error ?? "Couldn't save the settings. Please try again.");
    }

    applySettings(data.settings);
  }

  const trimmedSlack = slackUrl.trim();
  const slackError = trimmedSlack && !SLACK_PATTERN.test(trimmedSlack)
    ? "Paste a Slack incoming-webhook URL, like https://hooks.slack.com/services/T000/B000/XXXX."
    : "";
  const emailsChanged =
    settings !== null && emails.join(",") !== settings.notifyEmails.join(",");
  const hasChanges = emailsChanged || Boolean(trimmedSlack);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage || slackError || !hasChanges) {
      return;
    }

    setIsSaving(true);
    setNotice(null);

    try {
      await patch({
        notifyEmails: emails,
        ...(trimmedSlack ? { slackWebhookUrl: trimmedSlack } : {}),
      });
      setSlackUrl("");
      setNotice({ tone: "success", text: "Notification settings saved." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveSlack() {
    if (!window.confirm("Stop sending new-lead alerts to Slack?")) {
      return;
    }

    setIsRemovingSlack(true);
    setNotice(null);

    try {
      await patch({ slackWebhookUrl: "" });
      setNotice({ tone: "success", text: "Slack webhook removed." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't remove it." });
    } finally {
      setIsRemovingSlack(false);
    }
  }

  async function handleToggleAuto(next: boolean) {
    setIsTogglingAuto(true);
    setAutoNotice(null);

    try {
      await patch({ autoCaptureLeads: next });
      setAutoNotice({
        tone: "success",
        text: next ? "Automatic lead capture is on." : "Automatic lead capture is off.",
      });
    } catch (error) {
      setAutoNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't save." });
    } finally {
      setIsTogglingAuto(false);
    }
  }

  async function handleTest() {
    setIsTesting(true);
    setTestError("");
    setTestResults(null);

    try {
      const response = await fetch("/api/leads/settings/test", { method: "POST" });
      const data = await readJson<{ results?: TestResult[] }>(response);

      if (!response.ok || !data.results) {
        setTestError(data.error ?? "Couldn't send the test notification.");
        return;
      }

      setTestResults(data.results);
    } catch {
      setTestError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsTesting(false);
    }
  }

  if (!settings) {
    return (
      <Card title="Notifications" description="Tell your team the moment a new lead comes in.">
        {loadError ? (
          <div>
            <NoticeBox notice={{ tone: "error", text: loadError }} />
            <button type="button" onClick={() => void load()} className={`${secondaryButtonClass} mt-3`}>
              Try again
            </button>
          </div>
        ) : (
          <div className="space-y-3" aria-hidden="true">
            <div className="h-4 w-1/3 animate-pulse rounded bg-white/5" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-white/5" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-white/5" />
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      <form onSubmit={handleSave} noValidate>
        <Card
          title="Notifications"
          description="Tell your team the moment a new lead comes in."
          action={
            canManage ? (
              <button type="submit" disabled={isSaving || !hasChanges || Boolean(slackError)} className={primaryButtonClass}>
                {isSaving ? "Saving..." : "Save"}
              </button>
            ) : null
          }
        >
          <div className="space-y-5">
            <NoticeBox notice={notice} />

            <div>
              <label htmlFor="lead-notify-emails" className="mb-2 block text-sm font-medium text-white">
                Email recipients
              </label>
              <EmailChipsInput emails={emails} onChange={setEmails} disabled={!canManage || isSaving} />
              {!settings.emailConfigured ? (
                <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  Email notifications need a platform SMTP sender (ASSISTDESK_SMTP_HOST).
                  Recipients are saved, but no email is sent until it is configured.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="lead-slack-url" className="mb-2 block text-sm font-medium text-white">
                Slack incoming webhook URL
              </label>
              {settings.slackConfigured ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111111] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">Connected</p>
                    <p className="mt-0.5 break-all font-mono text-xs text-slate-200">
                      {settings.slackWebhookUrl}
                    </p>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => void handleRemoveSlack()}
                      disabled={isRemovingSlack}
                      className={dangerButtonClass}
                    >
                      {isRemovingSlack ? "Removing..." : "Remove"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {canManage ? (
                <>
                  <input
                    id="lead-slack-url"
                    type="password"
                    autoComplete="off"
                    value={slackUrl}
                    onChange={(event) => setSlackUrl(event.target.value)}
                    placeholder={
                      settings.slackConfigured
                        ? "Paste a new URL to replace it"
                        : "https://hooks.slack.com/services/…"
                    }
                    className={`${inputClass} ${slackError ? "border-red-500/50" : ""}`}
                  />
                  <p className={`mt-1.5 text-xs ${slackError ? "text-red-300" : "text-slate-500"}`}>
                    {slackError || (
                      <>
                        Posts each new lead to a Slack channel.{" "}
                        <a
                          href="https://api.slack.com/messaging/webhooks"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-slate-300 underline underline-offset-4 transition hover:text-white"
                        >
                          Create an incoming webhook
                        </a>
                      </>
                    )}
                  </p>
                </>
              ) : !settings.slackConfigured ? (
                <p className="text-sm text-slate-500">Not connected.</p>
              ) : null}
            </div>

            <p className="text-sm text-slate-400">
              Every new lead also appears in the dashboard notifications bell for your team.
            </p>

            {canManage ? (
              <div className="border-t border-white/10 pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleTest()}
                    disabled={isTesting}
                    className={secondaryButtonClass}
                  >
                    {isTesting ? (
                      <>
                        <Spinner />
                        Sending...
                      </>
                    ) : (
                      "Send test notification"
                    )}
                  </button>
                  <span className="text-xs text-slate-500">Uses the saved recipients and Slack URL.</span>
                </div>
                {testError ? (
                  <p className="mt-3 text-sm text-red-300" role="alert">
                    {testError}
                  </p>
                ) : null}
                {testResults ? (
                  <ul className="mt-3 space-y-1.5" aria-label="Test results">
                    {testResults.map((result, index) => (
                      <li
                        key={`${result.channel}-${index}`}
                        className={`flex items-start gap-2 text-sm ${result.ok ? "text-emerald-200" : "text-red-200"}`}
                      >
                        <span aria-hidden="true">{result.ok ? "✓" : "✗"}</span>
                        <span className="min-w-0 break-words">
                          <span className="font-semibold">{result.channel}</span>
                          {result.detail ? <span className="text-slate-400"> — {result.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>
      </form>

      <Card title="Automatic capture">
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-[#111111] px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Capture leads automatically</p>
            <p className="mt-1 text-sm text-slate-400">
              Create a lead when a customer who shared an email or phone (or messages on
              WhatsApp) shows buying intent — asks about prices, quotes, plans or demos.
            </p>
          </div>
          <Switch
            checked={settings.autoCaptureLeads}
            onChange={(next) => void handleToggleAuto(next)}
            disabled={!canManage || isTogglingAuto}
            label="Capture leads automatically"
          />
        </div>
        {autoNotice ? (
          <div className="mt-3">
            <NoticeBox notice={autoNotice} />
          </div>
        ) : null}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                             */
/* ------------------------------------------------------------------ */

function EventCheckboxes({
  idPrefix,
  events,
  selected,
  onChange,
}: {
  idPrefix: string;
  events: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-medium text-white">Events</legend>
      <div className="flex flex-wrap gap-3">
        {events.map((event) => {
          const id = `${idPrefix}-${event}`;
          const checked = selected.includes(event);

          return (
            <label
              key={event}
              htmlFor={id}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                checked ? "border-white/30 bg-white/[0.06] text-white" : "border-white/10 bg-[#111111] text-slate-400"
              }`}
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(checked ? selected.filter((item) => item !== event) : [...selected, event])
                }
                className="h-4 w-4 accent-white"
              />
              <span className="font-mono text-xs">{event}</span>
              <span className="text-xs text-slate-500">{eventLabels[event] ?? ""}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SecretBox({
  secret,
  endpointName,
  onDismiss,
}: {
  secret: string;
  endpointName: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Unable to copy. Select the secret and copy it manually.");
    }
  }

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4" role="status">
      <p className="text-sm font-semibold text-amber-100">Signing secret for {endpointName}</p>
      <p className="mt-1 text-sm text-amber-200">Copy it now — it won&apos;t be shown again.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-xl border border-white/10 bg-[#050505] px-4 py-3 font-mono text-xs text-white">
          {secret}
        </code>
        <div className="flex gap-2">
          <button type="button" onClick={() => void handleCopy()} className={secondaryButtonClass}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={onDismiss} className={secondaryButtonClass}>
            I&apos;ve saved it
          </button>
        </div>
      </div>
      {copyError ? <p className="mt-2 text-xs text-red-300">{copyError}</p> : null}
    </div>
  );
}

function DeliveryRow({
  delivery,
  onRetried,
}: {
  delivery: WebhookDelivery;
  onRetried: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<Notice>(null);
  const canRetry =
    (delivery.status === "FAILED" || delivery.status === "RETRYING") && delivery.event !== "webhook.test";

  async function handleRetry() {
    setIsRetrying(true);
    setRetryMessage(null);

    try {
      const response = await fetch(`/api/webhooks/deliveries/${delivery.id}/retry`, { method: "POST" });
      const data = await readJson<{ status?: DeliveryStatus; responseStatus?: number | null; error?: string | null }>(
        response,
      );

      if (!response.ok) {
        setRetryMessage({ tone: "error", text: data.error ?? "Couldn't retry this delivery." });
        return;
      }

      setRetryMessage(
        data.status === "SUCCESS"
          ? { tone: "success", text: `Delivered (HTTP ${data.responseStatus ?? "2xx"}).` }
          : { tone: "error", text: data.error ?? `Still failing${data.responseStatus ? ` (HTTP ${data.responseStatus})` : ""}.` },
      );
      onRetried();
    } catch {
      setRetryMessage({ tone: "error", text: "Couldn't reach the server. Check your connection." });
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-[#0d0d0d]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          className="inline-flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
          <span className="shrink-0 text-slate-400">{formatDateTime(delivery.createdAt)}</span>
          <span className="shrink-0 font-mono text-slate-200">{delivery.event}</span>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${deliveryStatusClass(delivery.status)}`}>
            {deliveryStatusLabels[delivery.status] ?? delivery.status}
          </span>
          <span className="shrink-0 text-slate-500">
            {delivery.attempts}/{MAX_ATTEMPTS} attempts
          </span>
          <span className="shrink-0 text-slate-500">
            {delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : "No response"}
          </span>
          {delivery.error ? <span className="min-w-0 truncate text-red-300">{delivery.error}</span> : null}
        </button>
        {canRetry ? (
          <button type="button" onClick={() => void handleRetry()} disabled={isRetrying} className={secondaryButtonClass}>
            {isRetrying ? (
              <>
                <Spinner />
                Retrying...
              </>
            ) : (
              "Retry"
            )}
          </button>
        ) : null}
      </div>

      {retryMessage ? (
        <p className={`px-4 pb-3 text-xs ${retryMessage.tone === "error" ? "text-red-300" : "text-emerald-200"}`}>
          {retryMessage.text}
        </p>
      ) : null}

      {isOpen ? (
        <div className="space-y-3 border-t border-white/10 px-4 py-4">
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Delivery ID (X-AssistDesk-Delivery)</dt>
              <dd className="mt-0.5 break-all font-mono text-slate-300">{delivery.id}</dd>
            </div>
            {delivery.lead ? (
              <div>
                <dt className="text-slate-500">Lead</dt>
                <dd className="mt-0.5">
                  <Link
                    href={`/dashboard/leads/${delivery.lead.id}`}
                    className="font-semibold text-slate-200 underline underline-offset-4 transition hover:text-white"
                  >
                    {delivery.lead.name || delivery.lead.email || "Open lead"}
                  </Link>
                </dd>
              </div>
            ) : null}
            {delivery.deliveredAt ? (
              <div>
                <dt className="text-slate-500">Delivered</dt>
                <dd className="mt-0.5 text-slate-300">{formatDateTime(delivery.deliveredAt)}</dd>
              </div>
            ) : null}
            {delivery.nextAttemptAt && delivery.status !== "SUCCESS" ? (
              <div>
                <dt className="text-slate-500">Next automatic attempt</dt>
                <dd className="mt-0.5 text-slate-300">{formatDateTime(delivery.nextAttemptAt)}</dd>
              </div>
            ) : null}
          </dl>
          {delivery.error ? (
            <p className="break-words text-xs text-red-300">{delivery.error}</p>
          ) : null}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-400">Payload</p>
            <pre className="max-h-72 overflow-auto rounded-xl border border-white/10 bg-[#050505] px-3 py-3 font-mono text-[11px] leading-5 text-slate-300">
              {prettyJson(delivery.payload)}
            </pre>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-400">Response body</p>
            {delivery.responseBody ? (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#050505] px-3 py-3 font-mono text-[11px] leading-5 text-slate-300">
                {prettyBody(delivery.responseBody)}
              </pre>
            ) : (
              <p className="text-xs text-slate-500">No response body.</p>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DeliveriesLog({ endpointId, reloadToken }: { endpointId: string; reloadToken: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ deliveries: WebhookDelivery[]; total: number; pageCount: number } | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [localToken, setLocalToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/webhooks/${endpointId}/deliveries?page=${page}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await readJson<{ deliveries?: WebhookDelivery[]; total?: number; pageCount?: number }>(response);

        if (!response.ok || !body.deliveries) {
          setError(body.error ?? "Couldn't load the delivery log.");
          return;
        }

        setData({ deliveries: body.deliveries, total: body.total ?? 0, pageCount: body.pageCount ?? 1 });
      } catch {
        if (!controller.signal.aborted) {
          setError("Couldn't load the delivery log. Check your connection.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [endpointId, page, reloadToken, localToken]);

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-white">
          Deliveries{data ? <span className="text-slate-500"> · {data.total}</span> : null}
        </p>
        <button
          type="button"
          onClick={() => setLocalToken((value) => value + 1)}
          disabled={isLoading}
          className={secondaryButtonClass}
        >
          {isLoading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

      {data && data.deliveries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
          No deliveries yet. Send a test or wait for the next lead.
        </p>
      ) : null}

      {data && data.deliveries.length > 0 ? (
        <ul className="space-y-2">
          {data.deliveries.map((delivery) => (
            <DeliveryRow key={delivery.id} delivery={delivery} onRetried={() => setLocalToken((value) => value + 1)} />
          ))}
        </ul>
      ) : null}

      {!data && !error ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-11 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : null}

      {data && data.pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || isLoading}
            className={secondaryButtonClass}
          >
            Previous
          </button>
          <span>
            Page {page} of {data.pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))}
            disabled={page >= data.pageCount || isLoading}
            className={secondaryButtonClass}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EndpointCard({
  endpoint,
  events,
  onUpdated,
  onRemoved,
  onSecret,
}: {
  endpoint: WebhookEndpoint;
  events: string[];
  onUpdated: (endpoint: WebhookEndpoint) => void;
  onRemoved: (id: string) => void;
  onSecret: (secret: string, name: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(endpoint.name);
  const [url, setUrl] = useState(endpoint.url);
  const [selectedEvents, setSelectedEvents] = useState(endpoint.events);
  const [busy, setBusy] = useState<"" | "save" | "toggle" | "test" | "rotate" | "delete">("");
  const [notice, setNotice] = useState<Notice>(null);
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [deliveriesToken, setDeliveriesToken] = useState(0);
  const lastOk = endpoint.lastStatus?.startsWith("HTTP 2") ?? false;

  async function patchEndpoint(body: Record<string, unknown>) {
    const response = await fetch(`/api/webhooks/${endpoint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await readJson<{ endpoint?: WebhookEndpoint }>(response);

    if (!response.ok || !data.endpoint) {
      throw new Error(data.error ?? "Couldn't update the webhook.");
    }

    // PATCH does not return delivery stats; keep the ones we have.
    onUpdated({ ...data.endpoint, stats: endpoint.stats });
    return data.endpoint;
  }

  function startEditing() {
    setName(endpoint.name);
    setUrl(endpoint.url);
    setSelectedEvents(endpoint.events);
    setNotice(null);
    setIsEditing(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedEvents.length === 0) {
      setNotice({ tone: "error", text: "Choose at least one event." });
      return;
    }

    setBusy("save");
    setNotice(null);

    try {
      await patchEndpoint({
        name: name.trim(),
        ...(url.trim() !== endpoint.url ? { url: url.trim() } : {}),
        events: selectedEvents,
      });
      setIsEditing(false);
      setNotice({ tone: "success", text: "Webhook updated." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't update." });
    } finally {
      setBusy("");
    }
  }

  async function handleToggle(next: boolean) {
    setBusy("toggle");
    setNotice(null);

    try {
      await patchEndpoint({ isActive: next });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Couldn't update." });
    } finally {
      setBusy("");
    }
  }

  async function handleTest() {
    setBusy("test");
    setNotice(null);
    setTestResult(null);

    try {
      const response = await fetch(`/api/webhooks/${endpoint.id}/test`, { method: "POST" });
      const data = await readJson<Partial<EndpointTestResult>>(response);

      if (!response.ok) {
        setNotice({ tone: "error", text: data.error ?? "Couldn't send the test." });
        return;
      }

      setTestResult({
        ok: data.ok === true,
        status: data.status ?? "",
        responseStatus: data.responseStatus ?? null,
        responseBody: data.responseBody ?? null,
        error: data.error ?? null,
      });
      setDeliveriesToken((value) => value + 1);
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusy("");
    }
  }

  async function handleRotate() {
    if (
      !window.confirm(
        `Rotate the signing secret for "${endpoint.name}"? The old secret stops working immediately, so update your receiver right after.`,
      )
    ) {
      return;
    }

    setBusy("rotate");
    setNotice(null);

    try {
      const response = await fetch(`/api/webhooks/${endpoint.id}/rotate`, { method: "POST" });
      const data = await readJson<{ endpoint?: WebhookEndpoint; secret?: string }>(response);

      if (!response.ok || !data.endpoint || !data.secret) {
        setNotice({ tone: "error", text: data.error ?? "Couldn't rotate the secret." });
        return;
      }

      onUpdated({ ...data.endpoint, stats: endpoint.stats });
      onSecret(data.secret, data.endpoint.name);
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the server. Check your connection." });
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete the webhook "${endpoint.name}"? Its delivery log is deleted too.`)) {
      return;
    }

    setBusy("delete");
    setNotice(null);

    try {
      const response = await fetch(`/api/webhooks/${endpoint.id}`, { method: "DELETE" });
      const data = await readJson<{ success?: boolean }>(response);

      if (!response.ok) {
        setNotice({ tone: "error", text: data.error ?? "Couldn't delete the webhook." });
        setBusy("");
        return;
      }

      onRemoved(endpoint.id);
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the server. Check your connection." });
      setBusy("");
    }
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-[#111111] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{endpoint.name}</p>
            {!endpoint.isActive ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-400">
                Paused
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-xs text-slate-400">{endpoint.url}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {endpoint.events.map((event) => (
              <span
                key={event}
                className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 font-mono text-[11px] text-slate-200"
              >
                {event}
              </span>
            ))}
          </div>
        </div>
        <Switch
          checked={endpoint.isActive}
          onChange={(next) => void handleToggle(next)}
          disabled={busy !== ""}
          label={`${endpoint.name} active`}
        />
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Last delivery</dt>
          <dd className="mt-0.5 text-slate-300">{formatDateTime(endpoint.lastDeliveryAt)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last status</dt>
          <dd className={`mt-0.5 break-words ${endpoint.lastStatus ? (lastOk ? "text-emerald-200" : "text-red-300") : "text-slate-500"}`}>
            {endpoint.lastStatus ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Last 30 days</dt>
          <dd className="mt-0.5 flex flex-wrap gap-3">
            <span className="text-emerald-200">{endpoint.stats.success} delivered</span>
            <span className="text-red-300">{endpoint.stats.failed} failed</span>
            <span className="text-amber-200">{endpoint.stats.pending} pending</span>
          </dd>
        </div>
        <div className="sm:col-span-4">
          <dt className="text-slate-500">Signing secret</dt>
          <dd className="mt-0.5 font-mono text-slate-300">{endpoint.secretPreview || "—"}</dd>
        </div>
      </dl>

      {isEditing ? (
        <form onSubmit={handleSave} className="mt-4 space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-4" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor={`webhook-${endpoint.id}-name`} className="mb-2 block text-sm font-medium text-white">
                Name
              </label>
              <input
                id={`webhook-${endpoint.id}-name`}
                type="text"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`webhook-${endpoint.id}-url`} className="mb-2 block text-sm font-medium text-white">
                URL
              </label>
              <input
                id={`webhook-${endpoint.id}-url`}
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
          <EventCheckboxes
            idPrefix={`webhook-${endpoint.id}-event`}
            events={events}
            selected={selectedEvents}
            onChange={setSelectedEvents}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== "" || !name.trim()} className={primaryButtonClass}>
              {busy === "save" ? "Saving..." : "Save webhook"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setNotice(null);
              }}
              className="pressable inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {notice ? (
        <div className="mt-4">
          <NoticeBox notice={notice} />
        </div>
      ) : null}

      {testResult ? (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            testResult.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/30 bg-red-500/10 text-red-200"
          }`}
          role="status"
        >
          <p className="font-semibold">
            {testResult.ok ? "✓ Test delivered" : "✗ Test failed"}
            {testResult.responseStatus ? ` — HTTP ${testResult.responseStatus}` : ""}
          </p>
          {testResult.error ? <p className="mt-1 break-words text-xs">{testResult.error}</p> : null}
          {testResult.responseBody ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#050505] px-3 py-2 font-mono text-[11px] leading-5 text-slate-300">
              {prettyBody(testResult.responseBody)}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void handleTest()} disabled={busy !== ""} className={secondaryButtonClass}>
          {busy === "test" ? (
            <>
              <Spinner />
              Sending...
            </>
          ) : (
            "Send test"
          )}
        </button>
        {!isEditing ? (
          <button type="button" onClick={startEditing} disabled={busy !== ""} className={secondaryButtonClass}>
            Edit
          </button>
        ) : null}
        <button type="button" onClick={() => void handleRotate()} disabled={busy !== ""} className={secondaryButtonClass}>
          {busy === "rotate" ? "Rotating..." : "Rotate secret"}
        </button>
        <button
          type="button"
          onClick={() => setShowDeliveries((value) => !value)}
          aria-expanded={showDeliveries}
          className={secondaryButtonClass}
        >
          {showDeliveries ? "Hide deliveries" : "Deliveries"}
        </button>
        <button type="button" onClick={() => void handleDelete()} disabled={busy !== ""} className={dangerButtonClass}>
          {busy === "delete" ? "Deleting..." : "Delete"}
        </button>
      </div>

      {showDeliveries ? <DeliveriesLog endpointId={endpoint.id} reloadToken={deliveriesToken} /> : null}
    </li>
  );
}

function VerifyHelp() {
  return (
    <details className="group rounded-xl border border-white/10 bg-[#0d0d0d]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-200 transition hover:text-white [&::-webkit-details-marker]:hidden">
        How to verify a webhook
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 text-slate-500 transition group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </summary>
      <div className="space-y-4 border-t border-white/10 px-4 py-4 text-sm leading-6 text-slate-300">
        <p>Each request is a JSON <span className="font-mono text-xs">POST</span> with these headers:</p>
        <dl className="space-y-2">
          <div>
            <dt className="font-mono text-xs text-white">X-AssistDesk-Event</dt>
            <dd className="text-slate-400">
              The event name, e.g. <span className="font-mono text-xs">lead.created</span>.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-white">X-AssistDesk-Delivery</dt>
            <dd className="text-slate-400">
              A stable delivery ID that stays the same across retries. Store it and ignore
              repeats (idempotency).
            </dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-white">X-AssistDesk-Signature</dt>
            <dd className="text-slate-400">
              <span className="font-mono text-xs">t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</span>, where v1 is
              the HMAC-SHA256 of <span className="font-mono text-xs">{"`${t}.${rawBody}`"}</span> using
              your signing secret.
            </dd>
          </div>
        </dl>
        <p className="text-slate-400">
          Reply with a 2xx status within 10 seconds. Otherwise we retry up to 3 times: after
          30 seconds, 2 minutes and 10 minutes. Every attempt is logged under Deliveries.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#050505] px-4 py-4 font-mono text-[11px] leading-5 text-slate-300">
          <code>{VERIFY_SNIPPET}</code>
        </pre>
      </div>
    </details>
  );
}

function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["lead.created", "lead.updated"]);
  const [formError, setFormError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<{ secret: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const response = await fetch("/api/webhooks", { cache: "no-store" });
      const data = await readJson<{ endpoints?: WebhookEndpoint[]; events?: string[] }>(response);

      if (!response.ok || !data.endpoints) {
        setLoadError(data.error ?? "Couldn't load webhooks.");
        return;
      }

      setEndpoints(data.endpoints);

      if (data.events?.length) {
        setEvents(data.events);
      }
    } catch {
      setLoadError("Couldn't load webhooks. Check your connection.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setName("");
    setUrl("");
    setSelectedEvents(["lead.created", "lead.updated"]);
    setFormError("");
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = url.trim();

    if (!name.trim()) {
      setFormError("Give the webhook a name, like \"HubSpot\" or \"Zapier\".");
      return;
    }

    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setFormError("Enter the full URL, starting with https://");
      return;
    }

    if (selectedEvents.length === 0) {
      setFormError("Choose at least one event.");
      return;
    }

    setIsCreating(true);
    setFormError("");

    try {
      const response = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: trimmedUrl, events: selectedEvents }),
      });
      const data = await readJson<{ endpoint?: WebhookEndpoint; secret?: string }>(response);

      if (!response.ok || !data.endpoint || !data.secret) {
        setFormError(data.error ?? "Couldn't add the webhook.");
        return;
      }

      const created = data.endpoint;
      setEndpoints((current) => [...(current ?? []), created]);
      setRevealedSecret({ secret: data.secret, name: created.name });
      resetForm();
      setShowForm(false);
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Card
      title="Webhooks"
      description="Send lead data to your CRM or automation tool (HubSpot, Zapier, Make…). Every request is signed."
      action={
        !showForm ? (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className={primaryButtonClass}
          >
            Add webhook
          </button>
        ) : null
      }
    >
      <div className="space-y-4">
        {revealedSecret ? (
          <SecretBox
            secret={revealedSecret.secret}
            endpointName={revealedSecret.name}
            onDismiss={() => setRevealedSecret(null)}
          />
        ) : null}

        {showForm ? (
          <form onSubmit={handleCreate} className="space-y-4 rounded-2xl border border-white/10 bg-[#111111] p-4" noValidate>
            <p className="text-sm font-semibold text-white">New webhook</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="webhook-new-name" className="mb-2 block text-sm font-medium text-white">
                  Name
                </label>
                <input
                  id="webhook-new-name"
                  type="text"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. HubSpot"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="webhook-new-url" className="mb-2 block text-sm font-medium text-white">
                  URL
                </label>
                <input
                  id="webhook-new-url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/webhooks/assistdesk"
                  className={`${inputClass} font-mono`}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Must be a public HTTPS address. Redirects are not followed.
                </p>
              </div>
            </div>
            <EventCheckboxes
              idPrefix="webhook-new-event"
              events={events}
              selected={selectedEvents}
              onChange={setSelectedEvents}
            />
            {formError ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={isCreating} className={primaryButtonClass}>
                {isCreating ? "Adding..." : "Add webhook"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="pressable inline-flex h-10 items-center justify-center rounded-lg border border-white/10 bg-[#111111] px-4 text-sm font-semibold text-white transition hover:bg-[#1a1a1a]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {loadError ? (
          <div>
            <NoticeBox notice={{ tone: "error", text: loadError }} />
            <button type="button" onClick={() => void load()} className={`${secondaryButtonClass} mt-3`}>
              Try again
            </button>
          </div>
        ) : null}

        {endpoints === null && !loadError ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="h-28 animate-pulse rounded-2xl bg-white/5" />
          </div>
        ) : null}

        {endpoints && endpoints.length === 0 && !showForm ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
            No webhooks yet. Add one to push new and updated leads to another system.
          </p>
        ) : null}

        {endpoints && endpoints.length > 0 ? (
          <ul className="space-y-3">
            {endpoints.map((endpoint) => (
              <EndpointCard
                key={endpoint.id}
                endpoint={endpoint}
                events={events}
                onUpdated={(updated) =>
                  setEndpoints((current) =>
                    (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
                  )
                }
                onRemoved={(id) => setEndpoints((current) => (current ?? []).filter((item) => item.id !== id))}
                onSecret={(secret, endpointName) => setRevealedSecret({ secret, name: endpointName })}
              />
            ))}
          </ul>
        ) : null}

        <VerifyHelp />
      </div>
    </Card>
  );
}

export function LeadSettingsWorkspace({ canManage }: { canManage: boolean }) {
  return (
    <div className="px-5 py-4 md:px-6">
      <div className="max-w-[900px]">
        <Link href="/dashboard/leads" className="text-sm text-slate-400 transition hover:text-white">
          ← Leads
        </Link>
        <h1 className="heading-font mt-3 text-[2rem] font-bold leading-none text-white">Lead settings</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Choose who hears about new leads, whether leads are captured automatically, and
          where lead data is sent.
        </p>

        {!canManage ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            Only admins can change lead notifications and webhooks. Ask a workspace admin or
            the owner if something here needs updating.
          </p>
        ) : null}

        <div className="mt-6 space-y-5">
          <NotificationsSection canManage={canManage} />
          {canManage ? <WebhooksSection /> : null}
        </div>
      </div>
    </div>
  );
}
