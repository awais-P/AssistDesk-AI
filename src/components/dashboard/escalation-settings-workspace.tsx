"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EscalationSettings } from "@/src/lib/escalation-triggers";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-white outline-none transition focus:border-white disabled:opacity-60";

function thresholdLabel(value: number) {
  if (value <= -0.75) return "Only very upset customers";
  if (value <= -0.45) return "Clearly frustrated customers (recommended)";
  return "Any sign of unhappiness";
}

function Toggle({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start justify-between gap-6 border-b border-white/10 py-4 last:border-b-0">
      <span>
        <span className="block font-semibold text-white">{label}</span>
        <span className="mt-0.5 block text-sm text-slate-400">{help}</span>
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
    </label>
  );
}

export function EscalationSettingsWorkspace({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<EscalationSettings | null>(null);
  const [keywordText, setKeywordText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/escalations/settings", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { settings?: EscalationSettings; error?: string };
      if (body.settings) {
        setSettings(body.settings);
        setKeywordText(body.settings.keywords.join("\n"));
      } else {
        setError(body.error ?? "Could not load the settings.");
      }
    })();
  }, []);

  function update(patch: Partial<EscalationSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setNotice("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    setNotice("");
    const keywords = keywordText
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      const response = await fetch("/api/escalations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, keywords }),
      });
      const body = (await response.json().catch(() => ({}))) as { settings?: EscalationSettings; error?: string };
      if (!response.ok || !body.settings) {
        setError(body.error ?? "Could not save the settings.");
        return;
      }
      setSettings(body.settings);
      setKeywordText(body.settings.keywords.join("\n"));
      setNotice("Escalation settings saved. They apply to the next customer message.");
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canManage || saving;

  return (
    <div className="px-5 py-4 md:px-6">
      <Link href="/dashboard/escalations" className="text-sm text-slate-400 hover:text-white">
        &larr; Escalations
      </Link>
      <h1 className="heading-font mt-3 text-[2rem] font-bold leading-none text-white">Escalation settings</h1>
      <p className="mt-3 max-w-3xl text-sm text-slate-400">
        When should the AI step aside for a person? These rules are checked on every customer message on the website, WhatsApp,
        Slack and email, before the AI replies. The AI can also hand over by itself when it cannot help.
      </p>

      {!canManage ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-[#111111] px-4 py-3 text-sm text-slate-300">
          Only workspace admins can change these settings.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {settings ? (
        <form onSubmit={save} className="mt-6 max-w-3xl space-y-6">
          <section className="rounded-[22px] border border-white/10 bg-[#0a0a0a] px-5">
            <Toggle
              id="esc-enabled"
              label="Automatic escalation"
              help="Turn off to rely only on the AI's own hand-over and your team taking over manually."
              checked={settings.enabled}
              disabled={disabled}
              onChange={(value) => update({ enabled: value })}
            />
            <Toggle
              id="esc-human"
              label="When the customer asks for a person"
              help='"Can I talk to a human?", "kisi insaan se baat karwao", "انسان سے بات" and similar.'
              checked={settings.onHumanRequest}
              disabled={disabled || !settings.enabled}
              onChange={(value) => update({ onHumanRequest: value })}
            />
            <Toggle
              id="esc-topics"
              label="Sensitive topics"
              help="Legal threats, payment disputes, fraud or a hacked account, cancellations, and anyone who may be at risk (urgent)."
              checked={settings.sensitiveTopics}
              disabled={disabled || !settings.enabled}
              onChange={(value) => update({ sensitiveTopics: value })}
            />
            <Toggle
              id="esc-sentiment"
              label="Negative sentiment"
              help="An angry message, or frustration that builds over three messages, in English, Roman Urdu or Urdu."
              checked={settings.sentimentEnabled}
              disabled={disabled || !settings.enabled}
              onChange={(value) => update({ sentimentEnabled: value })}
            />
          </section>

          <section className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <label htmlFor="esc-threshold" className="block font-semibold text-white">
              Sentiment threshold: {settings.sentimentThreshold.toFixed(2)}
            </label>
            <p className="mt-0.5 text-sm text-slate-400">{thresholdLabel(settings.sentimentThreshold)}. Scores run from -1 (furious) to +1 (delighted).</p>
            <input
              id="esc-threshold"
              type="range"
              min={-0.95}
              max={-0.1}
              step={0.05}
              value={settings.sentimentThreshold}
              disabled={disabled || !settings.enabled || !settings.sentimentEnabled}
              onChange={(event) => update({ sentimentThreshold: Number(event.target.value) })}
              className="mt-3 w-full"
            />
          </section>

          <section className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <label htmlFor="esc-keywords" className="block font-semibold text-white">
              Your own trigger phrases
            </label>
            <p className="mt-0.5 text-sm text-slate-400">One per line, e.g. &quot;refund&quot;, &quot;warranty claim&quot;. Whole words only; up to 30.</p>
            <textarea
              id="esc-keywords"
              rows={4}
              value={keywordText}
              disabled={disabled || !settings.enabled}
              onChange={(event) => {
                setKeywordText(event.target.value);
                setNotice("");
              }}
              className={`${inputClass} mt-3`}
            />
          </section>

          <section className="rounded-[22px] border border-white/10 bg-[#0a0a0a] p-5">
            <label htmlFor="esc-sla" className="block font-semibold text-white">
              Response time (SLA), minutes
            </label>
            <p className="mt-0.5 text-sm text-slate-400">
              If no one accepts an escalation within this time it is marked overdue and the team is alerted.
            </p>
            <input
              id="esc-sla"
              type="number"
              min={1}
              max={1440}
              value={settings.slaMinutes}
              disabled={disabled}
              onChange={(event) => update({ slaMinutes: Number(event.target.value) })}
              className={`${inputClass} mt-3 max-w-[160px]`}
            />
          </section>

          {canManage ? (
            <button
              type="submit"
              disabled={saving}
              className="pressable inline-flex h-10 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
