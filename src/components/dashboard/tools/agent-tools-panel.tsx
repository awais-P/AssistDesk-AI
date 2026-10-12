"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type IntentRule, matchIntentRules, parseIntentRules } from "@/src/lib/agent-engine/intent-rules";
import {
  Badge,
  Card,
  type Notice,
  NoticeBox,
  Spinner,
  Switch,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  readJson,
  secondaryButtonClass,
} from "./tool-ui";

/**
 * Module 2 FE-3 / FE-4 on the agent page: switch actions on, choose which tools the
 * agent may call, how many reasoning steps it gets, and intent → action rules.
 */

type AgentToolRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: "BUILT_IN" | "HTTP";
  isEnabled: boolean;
  requiresConfirmation: boolean;
  httpMethod: string | null;
  builtInKey: string | null;
  lastTestStatus: string | null;
  effect: "READ" | "WRITE";
  bound: boolean;
};

type AgentToolSettings = {
  toolsEnabled: boolean;
  maxToolSteps: number;
  escalateOnToolFailure: boolean;
  intentRules: IntentRule[];
};

type RuleDraft = { id: string; phrasesText: string; toolKey: string; mode: "PREFER" | "ALWAYS" };

type FormState = AgentToolSettings & { toolIds: string[]; rules: RuleDraft[] };

function toForm(settings: AgentToolSettings, tools: AgentToolRow[]): FormState {
  return {
    ...settings,
    toolIds: tools.filter((tool) => tool.bound).map((tool) => tool.id),
    rules: settings.intentRules.map((rule) => ({ id: rule.id, phrasesText: rule.phrases.join(", "), toolKey: rule.toolKey, mode: rule.mode })),
  };
}

function splitPhrases(text: string) {
  return text
    .split(/[,\n]/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function sameForm(a: FormState, b: FormState) {
  return (
    a.toolsEnabled === b.toolsEnabled &&
    a.maxToolSteps === b.maxToolSteps &&
    a.escalateOnToolFailure === b.escalateOnToolFailure &&
    [...a.toolIds].sort().join() === [...b.toolIds].sort().join() &&
    JSON.stringify(a.rules.map(({ phrasesText, toolKey, mode }) => [splitPhrases(phrasesText), toolKey, mode])) ===
      JSON.stringify(b.rules.map(({ phrasesText, toolKey, mode }) => [splitPhrases(phrasesText), toolKey, mode]))
  );
}

export function AgentToolsPanel({ agentId, onOpenPlayground }: { agentId: string; onOpenPlayground?: () => void }) {
  const [tools, setTools] = useState<AgentToolRow[] | null>(null);
  const [saved, setSaved] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [tryMessage, setTryMessage] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    const response = await fetch(`/api/ai-agents/${agentId}/tools`, { cache: "no-store" });
    const body = await readJson<{ agent: AgentToolSettings; tools: AgentToolRow[] }>(response);

    if (!response.ok) {
      setLoadError(body.error ?? "Could not load this agent's actions.");
      return;
    }

    const next = toForm(body.agent, body.tools);
    setTools(body.tools);
    setSaved(next);
    setForm(next);
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const boundTools = useMemo(() => (tools ?? []).filter((tool) => form?.toolIds.includes(tool.id)), [tools, form?.toolIds]);
  const dirty = Boolean(form && saved && !sameForm(form, saved));

  const previewRules = useMemo(
    () => parseIntentRules((form?.rules ?? []).map((rule) => ({ id: rule.id, phrases: splitPhrases(rule.phrasesText), toolKey: rule.toolKey, mode: rule.mode }))),
    [form?.rules],
  );
  const matched = useMemo(() => (tryMessage.trim() ? matchIntentRules(tryMessage, previewRules) : []), [tryMessage, previewRules]);

  if (loadError) {
    return (
      <div className="space-y-3">
        <NoticeBox notice={{ tone: "error", text: loadError }} />
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  if (!tools || !form || !saved) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Spinner /> Loading actions…
      </div>
    );
  }

  function update(patch: Partial<FormState>) {
    setNotice(null);
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleTool(tool: AgentToolRow) {
    if (!form) return;
    const on = form.toolIds.includes(tool.id);
    update({ toolIds: on ? form.toolIds.filter((id) => id !== tool.id) : [...form.toolIds, tool.id] });
  }

  function updateRule(id: string, patch: Partial<RuleDraft>) {
    if (!form) return;
    update({ rules: form.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  }

  function addRule() {
    if (!form) return;
    update({
      rules: [...form.rules, { id: `rule_${Date.now().toString(36)}`, phrasesText: "", toolKey: boundTools[0]?.key ?? "", mode: "PREFER" }],
    });
  }

  async function save() {
    if (!form) return;

    const unboundRule = form.rules.find((rule) => !boundTools.some((tool) => tool.key === rule.toolKey));
    if (unboundRule) {
      setNotice({ tone: "error", text: "Every intent rule must use one of the actions selected above." });
      return;
    }

    if (form.rules.some((rule) => splitPhrases(rule.phrasesText).length === 0)) {
      setNotice({ tone: "error", text: "Every intent rule needs at least one phrase, like \"where is my order\"." });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    const response = await fetch(`/api/ai-agents/${agentId}/tools`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolsEnabled: form.toolsEnabled,
        toolIds: form.toolIds,
        maxToolSteps: form.maxToolSteps,
        escalateOnToolFailure: form.escalateOnToolFailure,
        intentRules: form.rules.map((rule) => ({ id: rule.id, phrases: splitPhrases(rule.phrasesText), toolKey: rule.toolKey, mode: rule.mode })),
      }),
    });
    const body = await readJson<{ agent: AgentToolSettings; tools: AgentToolRow[] }>(response);
    setIsSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save the actions." });
      return;
    }

    const next = toForm(body.agent, body.tools);
    setTools(body.tools);
    setSaved(next);
    setForm(next);
    setNotice({
      tone: "success",
      text: next.toolsEnabled ? `Saved. This agent can now use ${next.toolIds.length} action${next.toolIds.length === 1 ? "" : "s"}.` : "Saved. Actions are off for this agent.",
    });
  }

  const builtIns = tools.filter((tool) => tool.type === "BUILT_IN");
  const custom = tools.filter((tool) => tool.type === "HTTP");

  const renderTool = (tool: AgentToolRow) => {
    const checked = form.toolIds.includes(tool.id);

    return (
      <li key={tool.id}>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
            checked ? "border-white/25 bg-white/[0.04]" : "border-white/10 bg-[#111111] hover:border-white/20"
          }`}
        >
          <input type="checkbox" checked={checked} onChange={() => toggleTool(tool)} className="mt-1 h-4 w-4 accent-white" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">{tool.name}</span>
              <code className="text-[11px] text-slate-500">{tool.key}</code>
              {tool.effect === "READ" ? <Badge tone="read">Lookup</Badge> : <Badge tone="write">Changes data</Badge>}
              {tool.requiresConfirmation ? <Badge tone="info">Asks customer first</Badge> : null}
              {!tool.isEnabled ? <Badge tone="error">Switched off on Tools page</Badge> : null}
              {tool.type === "HTTP" && tool.lastTestStatus && tool.lastTestStatus !== "OK" ? <Badge tone="warn">Last test failed</Badge> : null}
            </span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{tool.description}</span>
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <Card
        title="Actions"
        description={
          <>
            Let the agent do things for customers, not just answer: look up tickets, open tickets, book
            appointments, capture leads, hand over to your team, or call your own systems. It plans the
            steps itself and every action is recorded in{" "}
            <Link href="/dashboard/logs?tab=actions" className="text-white underline-offset-2 hover:underline">
              Logs → Actions
            </Link>
            .
          </>
        }
        action={<Switch checked={form.toolsEnabled} onChange={(next) => update({ toolsEnabled: next })} label="Let this agent take actions" />}
      >
        {!form.toolsEnabled ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            Actions are off. The agent answers from its knowledge base only.
          </p>
        ) : (
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-100">
            On for every channel this agent serves: website chat, WhatsApp, Slack and email. Actions
            marked “asks customer first” only run after the customer says yes in the chat; on email
            they are never run automatically.
          </p>
        )}
      </Card>

      <Card
        title="Allowed actions"
        description={`${form.toolIds.length} of ${tools.length} selected.`}
        action={
          <Link href="/dashboard/tools" className={secondaryButtonClass}>
            Manage tools
          </Link>
        }
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Built-in</p>
        <ul className="grid gap-2 lg:grid-cols-2">{builtIns.map(renderTool)}</ul>

        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Your systems</p>
        {custom.length ? (
          <ul className="grid gap-2 lg:grid-cols-2">{custom.map(renderTool)}</ul>
        ) : (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-slate-400">
            No custom tools yet. Connect order tracking, invoices or your CRM on the{" "}
            <Link href="/dashboard/tools" className="text-white underline-offset-2 hover:underline">
              Tools page
            </Link>
            .
          </p>
        )}
      </Card>

      <Card title="Reasoning" description="How far the agent may go on its own for one customer message.">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="max-tool-steps" className="text-sm font-medium text-white">
              Reasoning steps: <span className="text-emerald-300">{form.maxToolSteps}</span>
            </label>
            <input
              id="max-tool-steps"
              type="range"
              min={1}
              max={8}
              value={form.maxToolSteps}
              onChange={(event) => update({ maxToolSteps: Number(event.target.value) })}
              className="mt-3 w-full accent-white"
            />
            <p className="mt-1 text-xs text-slate-500">
              Each step can run one or more actions, then the agent reads the results. 3–4 suits most
              questions (for example, check free times → book → confirm). More steps take longer.
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Hand over when an action fails</p>
              <p className="mt-1 text-xs text-slate-500">
                If an action fails and the agent can&apos;t recover, the customer is told and the
                conversation is passed to your team (SRS: notify and escalate).
              </p>
            </div>
            <Switch checked={form.escalateOnToolFailure} onChange={(next) => update({ escalateOnToolFailure: next })} label="Hand over when an action fails" />
          </div>
        </div>
      </Card>

      <Card
        title="Intent rules"
        description="Map what customers say to the action to use. “Suggest” guides the agent; “Always” makes it run that action first."
        action={
          <button type="button" onClick={addRule} disabled={boundTools.length === 0 || form.rules.length >= 20} className={secondaryButtonClass}>
            Add rule
          </button>
        }
      >
        {form.rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-slate-400">
            No rules. The agent picks actions from their descriptions — rules make it more predictable,
            for example “where is my order, track order → Track order”.
          </p>
        ) : (
          <ul className="space-y-3">
            {form.rules.map((rule, index) => (
              <li key={rule.id} className="rounded-xl border border-white/10 bg-[#111111] p-3">
                <div className="grid gap-3 lg:grid-cols-[1fr_220px_170px_auto] lg:items-end">
                  <div>
                    <label htmlFor={`rule-phrases-${rule.id}`} className="mb-1 block text-xs font-medium text-slate-400">
                      When the customer says (comma-separated)
                    </label>
                    <input
                      id={`rule-phrases-${rule.id}`}
                      value={rule.phrasesText}
                      onChange={(event) => updateRule(rule.id, { phrasesText: event.target.value })}
                      placeholder="where is my order, track my order, order status"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor={`rule-tool-${rule.id}`} className="mb-1 block text-xs font-medium text-slate-400">
                      Use action
                    </label>
                    <select
                      id={`rule-tool-${rule.id}`}
                      value={rule.toolKey}
                      onChange={(event) => updateRule(rule.id, { toolKey: event.target.value })}
                      className={inputClass}
                    >
                      {!boundTools.some((tool) => tool.key === rule.toolKey) ? <option value={rule.toolKey}>Choose an action…</option> : null}
                      {boundTools.map((tool) => (
                        <option key={tool.id} value={tool.key}>
                          {tool.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`rule-mode-${rule.id}`} className="mb-1 block text-xs font-medium text-slate-400">
                      Mode
                    </label>
                    <select
                      id={`rule-mode-${rule.id}`}
                      value={rule.mode}
                      onChange={(event) => updateRule(rule.id, { mode: event.target.value as RuleDraft["mode"] })}
                      className={inputClass}
                    >
                      <option value="PREFER">Suggest</option>
                      <option value="ALWAYS">Always run first</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() => update({ rules: form.rules.filter((item) => item.id !== rule.id) })}
                    className={`${dangerButtonClass} h-11`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {form.rules.length ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <label htmlFor="rule-try" className="mb-1 block text-xs font-medium text-slate-400">
              Try a customer message
            </label>
            <input id="rule-try" value={tryMessage} onChange={(event) => setTryMessage(event.target.value)} placeholder="Hi, where is my order 1042?" className={inputClass} />
            {tryMessage.trim() ? (
              <p className="mt-2 text-xs text-slate-300">
                {matched.length
                  ? `Matches: ${matched
                      .map((rule) => `${tools.find((tool) => tool.key === rule.toolKey)?.name ?? rule.toolKey} (${rule.mode === "ALWAYS" ? "always run first" : "suggested"})`)
                      .join(", ")}`
                  : "No rule matches — the agent decides from the action descriptions."}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <NoticeBox notice={notice} />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/10 bg-[#0a0a0a]/95 p-3 backdrop-blur">
        {dirty ? <span className="mr-auto text-xs text-amber-200">Unsaved changes</span> : null}
        {onOpenPlayground && !dirty && form.toolsEnabled ? (
          <button type="button" onClick={onOpenPlayground} className={`${secondaryButtonClass} mr-auto h-10`}>
            Test in Playground
          </button>
        ) : null}
        <button type="button" disabled={!dirty || isSaving} onClick={() => setForm(saved)} className={`${secondaryButtonClass} h-10`}>
          Reset
        </button>
        <button type="button" disabled={!dirty || isSaving} onClick={() => void save()} className={primaryButtonClass}>
          {isSaving ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            "Save actions"
          )}
        </button>
      </div>
    </div>
  );
}
