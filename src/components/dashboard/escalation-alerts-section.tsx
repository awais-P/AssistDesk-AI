"use client";

import { useEffect, useState } from "react";

/**
 * Module 9: escalation alerts by email and Slack, and routing (shared queue or
 * round-robin). Part of the Escalation settings page.
 */

type Routing = "QUEUE" | "ROUND_ROBIN";
type Member = { id: string; fullName: string; role: string; online: boolean };
type AlertSettings = {
  notifyEmails: string[];
  slackWebhookUrl: string | null;
  slackConfigured: boolean;
  urgentOnly: boolean;
  routing: Routing;
  routingUserIds: string[];
  onlineOnly: boolean;
  emailConfigured: boolean;
};
type Loaded = { settings: AlertSettings; members: Member[] };

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-white outline-none transition focus:border-white disabled:opacity-60";
const buttonClass =
  "pressable inline-flex h-10 items-center justify-center rounded-lg px-5 text-sm font-semibold transition disabled:opacity-60";

export function EscalationAlertsSection({ canManage }: { canManage: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [emailText, setEmailText] = useState("");
  const [slackUrl, setSlackUrl] = useState("");
  const [removeSlack, setRemoveSlack] = useState(false);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [routing, setRouting] = useState<Routing>("QUEUE");
  const [members, setMembers] = useState<string[]>([]);
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(data: Loaded) {
    setLoaded(data);
    setEmailText(data.settings.notifyEmails.join("\n"));
    setSlackUrl("");
    setRemoveSlack(false);
    setUrgentOnly(data.settings.urgentOnly);
    setRouting(data.settings.routing);
    setMembers(data.settings.routingUserIds);
    setOnlineOnly(data.settings.onlineOnly);
  }

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/escalations/alerts", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
      if (body.settings && body.members) {
        apply(body as Loaded);
      } else {
        setError(body.error ?? "Could not load the alert settings.");
      }
    })();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    const payload: Record<string, unknown> = {
      notifyEmails: emailText
        .split(/[\n,;]/)
        .map((value) => value.trim())
        .filter(Boolean),
      urgentOnly,
      routing,
      routingUserIds: members,
      onlineOnly,
    };
    if (removeSlack) payload.slackWebhookUrl = null;
    else if (slackUrl.trim()) payload.slackWebhookUrl = slackUrl.trim();

    try {
      const response = await fetch("/api/escalations/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => ({}))) as Partial<Loaded> & { error?: string };
      if (!response.ok || !body.settings || !body.members) {
        setError(body.error ?? "Could not save the alerts and routing.");
        return;
      }
      apply(body as Loaded);
      setNotice(
        routing === "ROUND_ROBIN"
          ? "Saved. New escalations are now assigned in turn and the team is alerted."
          : "Saved. New escalations wait in the shared queue and the team is alerted.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/escalations/alerts/test", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { results?: Array<{ channel: string; ok: boolean; detail: string }>; error?: string };
      if (!response.ok || !body.results) {
        setError(body.error ?? "Could not send a test alert.");
        return;
      }
      const failed = body.results.filter((result) => !result.ok);
      const summary = body.results.map((result) => `${result.ok ? "✓" : "✗"} ${result.detail}`).join(" · ");
      if (failed.length) setError(`Test alert: ${summary}`);
      else setNotice(`Test alert sent: ${summary}`);
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) {
    return error ? (
      <p role="alert" className="mt-8 max-w-3xl rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        {error}
      </p>
    ) : null;
  }

  const disabled = !canManage || busy !== null;
  const saved = loaded.settings;

  return (
    <form onSubmit={save} className="mt-10 max-w-3xl space-y-6" aria-labelledby="esc-alerts-heading">
      <div>
        <h2 id="esc-alerts-heading" className="heading-font text-xl font-bold text-white">
          Alerts and routing
        </h2>
        <p className="mt-1 text-sm text-slate-400">Who hears about escalations outside the dashboard, and who they go to.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      <section className="space-y-5 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
        <div>
          <label htmlFor="esc-alert-emails" className="block font-semibold text-white">
            Email alerts to
          </label>
          <p className="mt-0.5 text-sm text-slate-400">One address per line, up to 10. Sent for new escalations and for ones nobody accepted in time.</p>
          {!saved.emailConfigured ? <p className="mt-1 text-sm text-amber-300">Email sending isn&apos;t set up on this server, so email alerts will fail.</p> : null}
          <textarea
            id="esc-alert-emails"
            rows={3}
            value={emailText}
            disabled={disabled}
            onChange={(event) => setEmailText(event.target.value)}
            placeholder="support-lead@yourcompany.com"
            className={`${inputClass} mt-3`}
          />
        </div>

        <div>
          <label htmlFor="esc-alert-slack" className="block font-semibold text-white">
            Slack channel (incoming webhook)
          </label>
          <p className="mt-0.5 text-sm text-slate-400">
            {saved.slackConfigured && !removeSlack ? `Connected: ${saved.slackWebhookUrl}. Paste a new URL to replace it.` : "In Slack: Apps → Incoming Webhooks → Add to a channel, then paste the URL."}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              id="esc-alert-slack"
              type="url"
              value={slackUrl}
              disabled={disabled}
              onChange={(event) => {
                setSlackUrl(event.target.value);
                setRemoveSlack(false);
              }}
              placeholder="https://hooks.slack.com/services/…"
              className={inputClass}
            />
            {saved.slackConfigured && !removeSlack ? (
              <button type="button" disabled={disabled} onClick={() => setRemoveSlack(true)} className={`${buttonClass} border border-white/10 text-slate-200 hover:border-white/30`}>
                Remove
              </button>
            ) : null}
          </div>
          {removeSlack ? <p className="mt-1 text-sm text-amber-300">Slack alerts will stop when you save.</p> : null}
        </div>

        <label htmlFor="esc-alert-urgent" className="flex items-start justify-between gap-6">
          <span>
            <span className="block font-semibold text-white">Only high and urgent escalations</span>
            <span className="mt-0.5 block text-sm text-slate-400">Missed response times are always sent.</span>
          </span>
          <input id="esc-alert-urgent" type="checkbox" role="switch" checked={urgentOnly} disabled={disabled} onChange={(event) => setUrgentOnly(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        </label>

        {canManage ? (
          <button
            type="button"
            disabled={disabled || (!saved.notifyEmails.length && !saved.slackConfigured)}
            onClick={() => void sendTest()}
            className={`${buttonClass} border border-white/10 text-slate-200 hover:border-white/30`}
            title={!saved.notifyEmails.length && !saved.slackConfigured ? "Save an email or a Slack URL first" : undefined}
          >
            {busy === "test" ? "Sending…" : "Send a test alert"}
          </button>
        ) : null}
      </section>

      <fieldset className="space-y-4 rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5" disabled={disabled}>
        <legend className="sr-only">Routing</legend>
        <p className="font-semibold text-white">Who gets new escalations</p>
        {(
          [
            ["QUEUE", "Shared queue", "Everyone sees it and the first person to accept takes it."],
            ["ROUND_ROBIN", "Round-robin", "Each new escalation is assigned to the next person in turn, who is emailed. Anyone can still accept it, and the response time still applies."],
          ] as const
        ).map(([value, label, help]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="esc-routing" value={value} checked={routing === value} onChange={() => setRouting(value)} className="mt-1 h-4 w-4" />
            <span>
              <span className="block text-sm font-semibold text-white">{label}</span>
              <span className="block text-sm text-slate-400">{help}</span>
            </span>
          </label>
        ))}

        {routing === "ROUND_ROBIN" ? (
          <div className="space-y-4 border-t border-white/10 pt-4">
            <div>
              <p className="text-sm font-semibold text-white">People in the rotation</p>
              <p className="text-sm text-slate-400">Leave all unticked to include everyone who handles conversations.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {loaded.members.map((member) => (
                  <li key={member.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={members.includes(member.id)}
                        onChange={(event) => setMembers((current) => (event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id)))}
                      />
                      <span className={`h-2 w-2 rounded-full ${member.online ? "bg-emerald-400" : "bg-slate-600"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{member.fullName}</span>
                      <span className="text-xs text-slate-500">
                        {member.role.toLowerCase()}
                        <span className="sr-only">{member.online ? ", online now" : ", offline"}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <label htmlFor="esc-routing-online" className="flex items-start justify-between gap-6">
              <span>
                <span className="block text-sm font-semibold text-white">Only people online now</span>
                <span className="block text-sm text-slate-400">If nobody in the rotation is online, the escalation waits in the shared queue.</span>
              </span>
              <input id="esc-routing-online" type="checkbox" role="switch" checked={onlineOnly} onChange={(event) => setOnlineOnly(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
            </label>
          </div>
        ) : null}
      </fieldset>

      {canManage ? (
        <button type="submit" disabled={busy !== null} className={`${buttonClass} bg-white text-black hover:bg-neutral-200`}>
          {busy === "save" ? "Saving..." : "Save alerts and routing"}
        </button>
      ) : null}
    </form>
  );
}
