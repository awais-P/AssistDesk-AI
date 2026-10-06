"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  Drawer,
  type Notice,
  NoticeBox,
  Spinner,
  Switch,
  dangerButtonClass,
  formatDateTime,
  formatLatency,
  inputClass,
  prettyJson,
  primaryButtonClass,
  readJson,
  secondaryButtonClass,
  textareaClass,
} from "./tool-ui";

/**
 * Module 2 Tools page (FE-1, FE-2b, FE-3): built-in actions and custom HTTP tools that
 * connect agents to the business's own systems, with a test runner for each.
 */

type ParameterType = "string" | "number" | "integer" | "boolean";

type ToolParameter = { name: string; type: ParameterType; description: string; required: boolean; enum?: string[] };

type ToolHeader = { name: string; value: string; secret: boolean };

type Tool = {
  id: string;
  key: string;
  name: string;
  description: string;
  defaultDescription: string | null;
  type: "BUILT_IN" | "HTTP";
  builtInKey: string | null;
  effect: "READ" | "WRITE";
  parameters: ToolParameter[];
  httpMethod: string | null;
  httpUrl: string | null;
  httpHeaders: ToolHeader[];
  httpBody: string | null;
  httpTimeoutMs: number;
  responseFields: string[];
  requiresConfirmation: boolean;
  isEnabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  agentIds: string[];
  stats: { calls: number; success: number; errors: number; avgLatencyMs: number | null };
};

type Agent = { id: string; name: string; toolsEnabled: boolean };

type Template = {
  id: string;
  label: string;
  tool: {
    name: string;
    description: string;
    parameters: ToolParameter[];
    httpMethod: string;
    httpUrl: string;
    httpHeaders: ToolHeader[];
    httpBody?: string;
    responseFields: string[];
    requiresConfirmation: boolean;
  };
};

type ToolsResponse = {
  tools: Tool[];
  agents: Agent[];
  templates: Template[];
  methods: string[];
  canManageHttp: boolean;
  limits: { customTools: number };
};

type TestResult = { ok: boolean; status: string; output: unknown; latencyMs: number };

type ParameterDraft = { uid: string; name: string; type: ParameterType; description: string; required: boolean; enumText: string };
type HeaderDraft = { uid: string; name: string; value: string; secret: boolean };

type HttpDraft = {
  id: string | null;
  name: string;
  description: string;
  httpMethod: string;
  httpUrl: string;
  parameters: ParameterDraft[];
  headers: HeaderDraft[];
  httpBody: string;
  responseFieldsText: string;
  httpTimeoutMs: number;
  requiresConfirmation: boolean;
  confirmationTouched: boolean;
  agentIds: string[];
};

const uid = () => Math.random().toString(36).slice(2, 10);

const builtInExamples: Record<string, string> = {
  get_customer_info: "“What email do you have for me?”",
  lookup_ticket_status: "“What's the status of AD-1042?”",
  create_ticket: "“My kettle stopped working, can someone look at it?”",
  capture_lead: "“I'd like a quote for 50 seats.”",
  escalate_to_human: "“Can I talk to a person?”",
  check_availability: "“Do you have anything free on Thursday?”",
  book_appointment: "“Book me in for 10:00 tomorrow.”",
  search_knowledge_base: "“What's your refund policy for opened items?”",
};

function draftFromTool(tool: Template["tool"] | Tool, id: string | null, agentIds: string[]): HttpDraft {
  return {
    id,
    name: tool.name,
    description: tool.description,
    httpMethod: tool.httpMethod ?? "GET",
    httpUrl: tool.httpUrl ?? "",
    parameters: tool.parameters.map((parameter) => ({ uid: uid(), ...parameter, enumText: parameter.enum?.join(", ") ?? "" })),
    headers: tool.httpHeaders.map((header) => ({ uid: uid(), ...header })),
    httpBody: tool.httpBody ?? "",
    responseFieldsText: tool.responseFields.join(", "),
    httpTimeoutMs: "httpTimeoutMs" in tool ? tool.httpTimeoutMs : 10_000,
    requiresConfirmation: tool.requiresConfirmation,
    confirmationTouched: Boolean(id),
    agentIds,
  };
}

function blankDraft(agentIds: string[]): HttpDraft {
  return {
    id: null,
    name: "",
    description: "",
    httpMethod: "GET",
    httpUrl: "https://",
    parameters: [{ uid: uid(), name: "", type: "string", description: "", required: true, enumText: "" }],
    headers: [],
    httpBody: "",
    responseFieldsText: "",
    httpTimeoutMs: 10_000,
    requiresConfirmation: false,
    confirmationTouched: false,
    agentIds,
  };
}

function placeholdersIn(value: string) {
  return [...value.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1]);
}

function successRate(stats: Tool["stats"]) {
  const finished = stats.success + stats.errors;
  return finished ? Math.round((stats.success / finished) * 100) : null;
}

function ToolStats({ tool, agents }: { tool: Tool; agents: Agent[] }) {
  const rate = successRate(tool.stats);
  const usedBy = agents.filter((agent) => tool.agentIds.includes(agent.id));

  return (
    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div className="rounded-lg bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Calls (30 days)</dt>
        <dd className="mt-0.5 font-semibold text-white">{tool.stats.calls}</dd>
      </div>
      <div className="rounded-lg bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Success</dt>
        <dd className={`mt-0.5 font-semibold ${rate === null ? "text-white" : rate >= 90 ? "text-emerald-300" : rate >= 70 ? "text-amber-200" : "text-red-300"}`}>
          {rate === null ? "—" : `${rate}%`}
        </dd>
      </div>
      <div className="rounded-lg bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Avg time</dt>
        <dd className="mt-0.5 font-semibold text-white">{formatLatency(tool.stats.avgLatencyMs)}</dd>
      </div>
      <div className="rounded-lg bg-white/[0.03] px-3 py-2">
        <dt className="text-slate-500">Used by</dt>
        <dd className="mt-0.5 truncate font-semibold text-white" title={usedBy.map((agent) => agent.name).join(", ")}>
          {usedBy.length ? usedBy.map((agent) => agent.name).join(", ") : "No agent"}
        </dd>
      </div>
    </dl>
  );
}

function TestDrawer({ tool, onClose, onTested }: { tool: Tool | null; onClose: () => void; onTested: (tool: Tool) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    setValues({});
    setResult(null);
    setError(null);
  }, [tool?.id]);

  async function run() {
    if (!tool) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    const input: Record<string, unknown> = {};
    for (const parameter of tool.parameters) {
      const raw = values[parameter.name]?.trim() ?? "";
      if (raw) input[parameter.name] = raw;
    }

    const response = await fetch(`/api/tools/${tool.id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const body = await readJson<TestResult & { tool: Tool }>(response);
    setIsRunning(false);

    if (!response.ok) {
      setError(body.error ?? "The test could not run.");
      return;
    }

    setResult(body);
    onTested(body.tool);
  }

  const simulated = tool?.type === "BUILT_IN" && tool.effect === "WRITE";

  return (
    <Drawer open={Boolean(tool)} title={tool ? `Test: ${tool.name}` : "Test tool"} description="Run the action once with sample inputs, exactly as the AI would." onClose={onClose}>
      {tool ? (
        <div className="space-y-4">
          {simulated ? (
            <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              Test mode: this action changes data, so the test only shows what would happen. Nothing is
              created.
            </p>
          ) : tool.type === "HTTP" ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              This really calls {tool.httpMethod} {tool.httpUrl?.replace(/^https?:\/\//, "").split("/")[0]}.
              {tool.effect === "WRITE" ? " Use test data — it may create something in that system." : ""}
            </p>
          ) : null}

          {tool.parameters.length === 0 ? <p className="text-sm text-slate-400">This action has no inputs.</p> : null}

          {tool.parameters.map((parameter) => (
            <div key={parameter.name}>
              <label htmlFor={`test-${parameter.name}`} className="mb-1 flex items-center gap-2 text-sm font-medium text-white">
                <code>{parameter.name}</code>
                <span className="text-xs font-normal text-slate-500">
                  {parameter.type}
                  {parameter.required ? " · required" : " · optional"}
                </span>
              </label>
              {parameter.enum ? (
                <select id={`test-${parameter.name}`} value={values[parameter.name] ?? ""} onChange={(event) => setValues({ ...values, [parameter.name]: event.target.value })} className={inputClass}>
                  <option value="">—</option>
                  {parameter.enum.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : parameter.type === "boolean" ? (
                <select id={`test-${parameter.name}`} value={values[parameter.name] ?? ""} onChange={(event) => setValues({ ...values, [parameter.name]: event.target.value })} className={inputClass}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  id={`test-${parameter.name}`}
                  inputMode={parameter.type === "string" ? undefined : "decimal"}
                  value={values[parameter.name] ?? ""}
                  onChange={(event) => setValues({ ...values, [parameter.name]: event.target.value })}
                  placeholder={parameter.description}
                  className={inputClass}
                />
              )}
              <p className="mt-1 text-xs text-slate-500">{parameter.description}</p>
            </div>
          ))}

          <button type="button" onClick={() => void run()} disabled={isRunning} className={primaryButtonClass}>
            {isRunning ? (
              <>
                <Spinner /> Running…
              </>
            ) : (
              "Run test"
            )}
          </button>

          <NoticeBox notice={error ? { tone: "error", text: error } : null} />

          {result ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={result.ok ? "ok" : "error"}>{result.ok ? "Success" : result.status === "ERROR" ? "Failed" : result.status}</Badge>
                <span className="text-xs text-slate-400">{formatLatency(result.latencyMs)}</span>
              </div>
              <p className="text-xs text-slate-500">What the AI receives:</p>
              <pre className="max-h-[360px] overflow-auto rounded-xl border border-white/10 bg-[#050505] p-3 text-xs leading-5 text-slate-200">{prettyJson(result.output)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function BuiltInDrawer({
  tool,
  canManageHttp,
  onClose,
  onSaved,
}: {
  tool: Tool | null;
  canManageHttp: boolean;
  onClose: () => void;
  onSaved: (tool: Tool) => void;
}) {
  const [description, setDescription] = useState("");
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDescription(tool?.description ?? "");
    setRequiresConfirmation(tool?.requiresConfirmation ?? false);
    setNotice(null);
  }, [tool]);

  async function save() {
    if (!tool) return;
    setIsSaving(true);
    const payload: Record<string, unknown> = { description };
    if (requiresConfirmation !== tool.requiresConfirmation) payload.requiresConfirmation = requiresConfirmation;
    const response = await fetch(`/api/tools/${tool.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await readJson<{ tool: Tool }>(response);
    setIsSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save." });
      return;
    }

    onSaved(body.tool);
    onClose();
  }

  return (
    <Drawer open={Boolean(tool)} title={tool ? `Edit: ${tool.name}` : "Edit action"} description="The AI reads this description to decide when to use the action." onClose={onClose}>
      {tool ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="builtin-description" className="mb-1 block text-sm font-medium text-white">
              When should the AI use it?
            </label>
            <textarea id="builtin-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} className={textareaClass} />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
              <span>{description.trim().length}/1000</span>
              {tool.defaultDescription && description !== tool.defaultDescription ? (
                <button type="button" onClick={() => setDescription(tool.defaultDescription ?? "")} className="text-slate-300 underline-offset-2 hover:underline">
                  Restore default
                </button>
              ) : null}
            </div>
          </div>

          {tool.effect === "WRITE" ? (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-[#111111] p-4">
              <div>
                <p className="text-sm font-medium text-white">Ask the customer first</p>
                <p className="mt-1 text-xs text-slate-500">
                  The AI asks “Shall I go ahead?” and the action runs only after the customer says yes.
                  {!canManageHttp ? " Only admins can change this." : ""}
                </p>
              </div>
              <Switch checked={requiresConfirmation} onChange={setRequiresConfirmation} disabled={!canManageHttp} label="Ask the customer first" />
            </div>
          ) : null}

          <NoticeBox notice={notice} />
          <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
            <button type="button" onClick={onClose} className={`${secondaryButtonClass} h-10`}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={isSaving} className={primaryButtonClass}>
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function HttpToolDrawer({
  draft,
  setDraft,
  agents,
  methods,
  onClose,
  onSaved,
}: {
  draft: HttpDraft | null;
  setDraft: (draft: HttpDraft) => void;
  agents: Agent[];
  methods: string[];
  onClose: () => void;
  onSaved: (tool: Tool, created: boolean) => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const [isSaving, setIsSaving] = useState(false);

  const draftKey = draft ? (draft.id ?? "new") : null;

  useEffect(() => {
    setNotice(null);
  }, [draftKey]);

  const problems = useMemo(() => {
    if (!draft) return [];
    const names = draft.parameters.map((parameter) => parameter.name.trim()).filter(Boolean);
    const list: string[] = [];
    const unknownUrl = placeholdersIn(draft.httpUrl).filter((name) => !names.includes(name));
    const unknownBody = placeholdersIn(draft.httpBody).filter((name) => !names.includes(name));
    if (unknownUrl.length) list.push(`The URL uses {${unknownUrl.join("}, {")}} — add ${unknownUrl.length === 1 ? "it" : "them"} as an input.`);
    if (unknownBody.length) list.push(`The body uses {${unknownBody.join("}, {")}} — add ${unknownBody.length === 1 ? "it" : "them"} as an input.`);
    if (new Set(names).size !== names.length) list.push("Two inputs have the same name.");
    if (names.includes("reason")) list.push("“reason” is reserved — the AI always sends its reason separately.");
    if (/^https?:\/\/[^/]*\{/.test(draft.httpUrl)) list.push("Inputs can't be part of the host name.");
    if (draft.httpBody.trim()) {
      try {
        JSON.parse(draft.httpBody.replace(/"\{[a-z][a-z0-9_]*\}"/g, '"x"'));
      } catch {
        list.push("The body template is not valid JSON.");
      }
    }
    return list;
  }, [draft]);

  if (!draft) {
    return <Drawer open={false} title="" onClose={onClose}><span /></Drawer>;
  }

  const update = (patch: Partial<HttpDraft>) => setDraft({ ...draft, ...patch });
  const hasBody = !["GET", "DELETE"].includes(draft.httpMethod);

  async function save() {
    if (!draft) return;
    setIsSaving(true);
    setNotice(null);

    const payload = {
      name: draft.name,
      description: draft.description,
      httpMethod: draft.httpMethod,
      httpUrl: draft.httpUrl,
      parameters: draft.parameters
        .filter((parameter) => parameter.name.trim())
        .map((parameter) => ({
          name: parameter.name.trim(),
          type: parameter.type,
          description: parameter.description,
          required: parameter.required,
          enum: parameter.type === "string" ? parameter.enumText.split(",").map((option) => option.trim()).filter(Boolean) : undefined,
        })),
      httpHeaders: draft.headers.filter((header) => header.name.trim()).map(({ name, value, secret }) => ({ name: name.trim(), value, secret })),
      httpBody: hasBody ? draft.httpBody : "",
      responseFields: draft.responseFieldsText.split(",").map((field) => field.trim()).filter(Boolean),
      httpTimeoutMs: draft.httpTimeoutMs,
      requiresConfirmation: draft.requiresConfirmation,
      ...(draft.id ? {} : { agentIds: draft.agentIds }),
    };

    const response = await fetch(draft.id ? `/api/tools/${draft.id}` : "/api/tools", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJson<{ tool: Tool }>(response);
    setIsSaving(false);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not save the tool." });
      return;
    }

    onSaved(body.tool, !draft.id);
  }

  return (
    <Drawer
      open
      width="max-w-[720px]"
      title={draft.id ? `Edit: ${draft.name || "tool"}` : "New tool"}
      description="Connect the AI to your own system with an HTTPS API call."
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="tool-name" className="mb-1 block text-sm font-medium text-white">
              Name
            </label>
            <input id="tool-name" value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Track order" maxLength={80} className={inputClass} />
            {!draft.id && draft.name.trim() ? (
              <p className="mt-1 text-xs text-slate-500">
                The AI calls it <code>{draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)}</code>
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="tool-timeout" className="mb-1 block text-sm font-medium text-white">
              Timeout
            </label>
            <select id="tool-timeout" value={draft.httpTimeoutMs} onChange={(event) => update({ httpTimeoutMs: Number(event.target.value) })} className={inputClass}>
              {[3000, 5000, 10000, 15000].map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} seconds
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="tool-description" className="mb-1 block text-sm font-medium text-white">
            What it does and when to use it
          </label>
          <textarea
            id="tool-description"
            rows={3}
            value={draft.description}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="Get the delivery status of an order from its order number. Use it whenever the customer asks where their order is."
            className={textareaClass}
          />
          <p className="mt-1 text-xs text-slate-500">The AI reads this to decide when to call the tool — be specific.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-4">
          <p className="text-sm font-semibold text-white">Request</p>
          <div className="mt-3 grid gap-3 md:grid-cols-[130px_1fr]">
            <select
              aria-label="HTTP method"
              value={draft.httpMethod}
              onChange={(event) => {
                const method = event.target.value;
                update({ httpMethod: method, ...(draft.confirmationTouched ? {} : { requiresConfirmation: method !== "GET" }) });
              }}
              className={inputClass}
            >
              {methods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <input
              aria-label="URL"
              value={draft.httpUrl}
              onChange={(event) => update({ httpUrl: event.target.value })}
              placeholder="https://api.example.com/orders/{order_number}"
              className={`${inputClass} font-mono text-xs`}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Put inputs in the path or query with braces, like <code>{"{order_number}"}</code>. Values are URL-encoded.
            {hasBody ? " Inputs not used in the body template are sent as JSON fields." : " Inputs not in the URL are added to the query string."}
          </p>

          {hasBody ? (
            <div className="mt-4">
              <label htmlFor="tool-body" className="mb-1 block text-xs font-medium text-slate-400">
                Body template (JSON, optional)
              </label>
              <textarea
                id="tool-body"
                rows={4}
                value={draft.httpBody}
                onChange={(event) => update({ httpBody: event.target.value })}
                placeholder={'{"order_number": "{order_number}", "send_email": true}'}
                className={`${textareaClass} font-mono text-xs`}
              />
              <p className="mt-1 text-xs text-slate-500">
                <code>{'"{name}"'}</code> on its own keeps the input&apos;s type (number, true/false).
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Inputs the AI collects</p>
              <p className="mt-0.5 text-xs text-slate-500">The AI asks the customer for required inputs it doesn&apos;t know yet.</p>
            </div>
            <button
              type="button"
              disabled={draft.parameters.length >= 10}
              onClick={() => update({ parameters: [...draft.parameters, { uid: uid(), name: "", type: "string", description: "", required: false, enumText: "" }] })}
              className={secondaryButtonClass}
            >
              Add input
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {draft.parameters.map((parameter) => {
              const change = (patch: Partial<ParameterDraft>) =>
                update({ parameters: draft.parameters.map((item) => (item.uid === parameter.uid ? { ...item, ...patch } : item)) });

              return (
                <li key={parameter.uid} className="rounded-lg border border-white/10 bg-[#111111] p-3">
                  <div className="grid gap-2 md:grid-cols-[1fr_120px_auto_auto] md:items-center">
                    <input
                      aria-label="Input name"
                      value={parameter.name}
                      onChange={(event) => change({ name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                      placeholder="order_number"
                      className={`${inputClass} h-10 font-mono text-xs`}
                    />
                    <select aria-label="Input type" value={parameter.type} onChange={(event) => change({ type: event.target.value as ParameterType })} className={`${inputClass} h-10`}>
                      <option value="string">Text</option>
                      <option value="number">Number</option>
                      <option value="integer">Whole number</option>
                      <option value="boolean">Yes / no</option>
                    </select>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={parameter.required} onChange={(event) => change({ required: event.target.checked })} className="h-4 w-4 accent-white" />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => update({ parameters: draft.parameters.filter((item) => item.uid !== parameter.uid) })}
                      className={dangerButtonClass}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input
                      aria-label="Input description"
                      value={parameter.description}
                      onChange={(event) => change({ description: event.target.value })}
                      placeholder="What it is, e.g. The order number, like 1042"
                      className={`${inputClass} h-10`}
                    />
                    {parameter.type === "string" ? (
                      <input
                        aria-label="Allowed values"
                        value={parameter.enumText}
                        onChange={(event) => change({ enumText: event.target.value })}
                        placeholder="Allowed values (optional): standard, express"
                        className={`${inputClass} h-10`}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#0d0d0d] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Headers</p>
              <p className="mt-0.5 text-xs text-slate-500">Secret values are encrypted and never shown again — leave one blank to keep it.</p>
            </div>
            <button
              type="button"
              disabled={draft.headers.length >= 10}
              onClick={() => update({ headers: [...draft.headers, { uid: uid(), name: "", value: "", secret: false }] })}
              className={secondaryButtonClass}
            >
              Add header
            </button>
          </div>
          {draft.headers.length ? (
            <ul className="mt-3 space-y-2">
              {draft.headers.map((header) => {
                const change = (patch: Partial<HeaderDraft>) => update({ headers: draft.headers.map((item) => (item.uid === header.uid ? { ...item, ...patch } : item)) });
                const masked = header.secret && header.value.startsWith("••••");

                return (
                  <li key={header.uid} className="grid gap-2 md:grid-cols-[180px_1fr_auto_auto] md:items-center">
                    <input
                      aria-label="Header name"
                      value={header.name}
                      onChange={(event) => {
                        const name = event.target.value;
                        change({ name, ...(/authorization|api[-_]?key|token|secret/i.test(name) ? { secret: true } : {}) });
                      }}
                      placeholder="Authorization"
                      className={`${inputClass} h-10 font-mono text-xs`}
                    />
                    <input
                      aria-label="Header value"
                      type={header.secret && !masked ? "password" : "text"}
                      value={masked ? "" : header.value}
                      onChange={(event) => change({ value: event.target.value })}
                      placeholder={masked ? `Saved (${header.value}) — type to replace` : "Bearer …"}
                      autoComplete="off"
                      className={`${inputClass} h-10 font-mono text-xs`}
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={header.secret}
                        // A stored secret is never revealed: un-marking it means typing a new value.
                        onChange={(event) => change({ secret: event.target.checked, ...(masked && !event.target.checked ? { value: "" } : {}) })}
                        className="h-4 w-4 accent-white"
                      />
                      Secret
                    </label>
                    <button type="button" onClick={() => update({ headers: draft.headers.filter((item) => item.uid !== header.uid) })} className={dangerButtonClass}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <div>
          <label htmlFor="tool-fields" className="mb-1 block text-sm font-medium text-white">
            Fields the AI sees from the response
          </label>
          <input
            id="tool-fields"
            value={draft.responseFieldsText}
            onChange={(event) => update({ responseFieldsText: event.target.value })}
            placeholder="status, estimatedDelivery, items, customer.name"
            className={`${inputClass} font-mono text-xs`}
          />
          <p className="mt-1 text-xs text-slate-500">Comma-separated, dots for nested fields. Leave empty to pass the whole (trimmed) response. Keeping only what&apos;s needed protects private data.</p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-[#111111] p-4">
          <div>
            <p className="text-sm font-medium text-white">Ask the customer first</p>
            <p className="mt-1 text-xs text-slate-500">
              Recommended for anything that creates, changes or deletes something. The AI asks “Shall I go ahead?” and the call runs only after a yes.
            </p>
          </div>
          <Switch checked={draft.requiresConfirmation} onChange={(next) => update({ requiresConfirmation: next, confirmationTouched: true })} label="Ask the customer first" />
        </div>

        {!draft.id && agents.length ? (
          <div>
            <p className="mb-2 text-sm font-medium text-white">Let these agents use it</p>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => {
                const checked = draft.agentIds.includes(agent.id);
                return (
                  <label key={agent.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? "border-white/30 bg-white/[0.06] text-white" : "border-white/10 text-slate-300"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => update({ agentIds: checked ? draft.agentIds.filter((id) => id !== agent.id) : [...draft.agentIds, agent.id] })}
                      className="h-3.5 w-3.5 accent-white"
                    />
                    {agent.name}
                    {!agent.toolsEnabled ? <span className="text-slate-500">(actions off)</span> : null}
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        {problems.length ? (
          <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            {problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
        <NoticeBox notice={notice} />

        <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} h-10`}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={isSaving || problems.length > 0} className={primaryButtonClass}>
            {isSaving ? (
              <>
                <Spinner /> Saving…
              </>
            ) : draft.id ? (
              "Save changes"
            ) : (
              "Create tool"
            )}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

export function ToolsWorkspace() {
  const [data, setData] = useState<ToolsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [testing, setTesting] = useState<Tool | null>(null);
  const [editingBuiltIn, setEditingBuiltIn] = useState<Tool | null>(null);
  const [draft, setDraft] = useState<HttpDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const response = await fetch("/api/tools", { cache: "no-store" });
    const body = await readJson<ToolsResponse>(response);

    if (!response.ok) {
      setLoadError(body.error ?? "Could not load tools.");
      return;
    }

    setData(body);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceTool = (tool: Tool) => setData((current) => (current ? { ...current, tools: current.tools.map((item) => (item.id === tool.id ? { ...tool, stats: item.stats } : item)) } : current));

  async function toggle(tool: Tool, isEnabled: boolean) {
    setBusyId(tool.id);
    setNotice(null);
    const response = await fetch(`/api/tools/${tool.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isEnabled }) });
    const body = await readJson<{ tool: Tool }>(response);
    setBusyId(null);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not update the tool." });
      return;
    }

    replaceTool(body.tool);
  }

  async function remove(tool: Tool) {
    if (!window.confirm(`Delete “${tool.name}”? Agents stop using it immediately. Past calls stay in the action log.`)) return;
    setBusyId(tool.id);
    const response = await fetch(`/api/tools/${tool.id}`, { method: "DELETE" });
    const body = await readJson<{ success: boolean }>(response);
    setBusyId(null);

    if (!response.ok) {
      setNotice({ tone: "error", text: body.error ?? "Could not delete the tool." });
      return;
    }

    setData((current) => (current ? { ...current, tools: current.tools.filter((item) => item.id !== tool.id) } : current));
    setNotice({ tone: "success", text: `Deleted “${tool.name}”.` });
  }

  if (loadError) {
    return (
      <div className="space-y-3 px-5 py-4 md:px-6">
        <NoticeBox notice={{ tone: "error", text: loadError }} />
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 px-5 py-6 text-sm text-slate-400 md:px-6">
        <Spinner /> Loading tools…
      </div>
    );
  }

  const builtIns = data.tools.filter((tool) => tool.type === "BUILT_IN");
  const custom = data.tools.filter((tool) => tool.type === "HTTP");
  const totals = data.tools.reduce(
    (sum, tool) => ({ calls: sum.calls + tool.stats.calls, success: sum.success + tool.stats.success, errors: sum.errors + tool.stats.errors }),
    { calls: 0, success: 0, errors: 0 },
  );
  const agentsWithActions = data.agents.filter((agent) => agent.toolsEnabled);
  const defaultAgentIds = agentsWithActions.length ? agentsWithActions.map((agent) => agent.id) : data.agents.slice(0, 1).map((agent) => agent.id);

  const renderBuiltIn = (tool: Tool) => (
    <li key={tool.id} className={`rounded-2xl border p-4 transition ${tool.isEnabled ? "border-white/10 bg-[#0a0a0a]" : "border-white/5 bg-[#070707] opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{tool.name}</p>
            {tool.effect === "READ" ? <Badge tone="read">Lookup</Badge> : <Badge tone="write">Changes data</Badge>}
            {tool.requiresConfirmation ? <Badge tone="info">Asks customer first</Badge> : null}
          </div>
          <code className="text-[11px] text-slate-500">{tool.key}</code>
        </div>
        <Switch checked={tool.isEnabled} disabled={busyId === tool.id} onChange={(next) => void toggle(tool, next)} label={`${tool.isEnabled ? "Switch off" : "Switch on"} ${tool.name}`} />
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{tool.description}</p>
      {builtInExamples[tool.key] ? <p className="mt-2 text-xs text-slate-500">e.g. {builtInExamples[tool.key]}</p> : null}
      <ToolStats tool={tool} agents={data.agents} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setEditingBuiltIn(tool)} className={secondaryButtonClass}>
          Edit
        </button>
        <button type="button" onClick={() => setTesting(tool)} className={secondaryButtonClass}>
          Test
        </button>
      </div>
    </li>
  );

  const renderCustom = (tool: Tool) => (
    <li key={tool.id} className={`rounded-2xl border p-4 ${tool.isEnabled ? "border-white/10 bg-[#0a0a0a]" : "border-white/5 bg-[#070707] opacity-70"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{tool.name}</p>
            {tool.effect === "READ" ? <Badge tone="read">Lookup</Badge> : <Badge tone="write">Changes data</Badge>}
            {tool.requiresConfirmation ? <Badge tone="info">Asks customer first</Badge> : null}
            {tool.lastTestStatus === "OK" ? <Badge tone="ok">Test passed</Badge> : tool.lastTestStatus ? <Badge tone="error">Test failed</Badge> : <Badge>Not tested</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-slate-500" title={tool.httpUrl ?? ""}>
            {tool.httpMethod} {tool.httpUrl}
          </p>
        </div>
        <Switch checked={tool.isEnabled} disabled={busyId === tool.id} onChange={(next) => void toggle(tool, next)} label={`${tool.isEnabled ? "Switch off" : "Switch on"} ${tool.name}`} />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{tool.description}</p>
      {tool.lastTestStatus && tool.lastTestStatus !== "OK" ? (
        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200">
          Last test ({formatDateTime(tool.lastTestedAt)}): {tool.lastTestStatus}
        </p>
      ) : null}
      <ToolStats tool={tool} agents={data.agents} />
      <div className="mt-3 flex flex-wrap gap-2">
        {data.canManageHttp ? (
          <>
            <button type="button" onClick={() => setDraft(draftFromTool(tool, tool.id, tool.agentIds))} className={secondaryButtonClass}>
              Edit
            </button>
            <button type="button" onClick={() => setTesting(tool)} className={secondaryButtonClass}>
              Test
            </button>
            <button type="button" disabled={busyId === tool.id} onClick={() => void remove(tool)} className={dangerButtonClass}>
              Delete
            </button>
          </>
        ) : (
          <span className="text-xs text-slate-500">Only admins can edit or test tools that call your systems.</span>
        )}
      </div>
    </li>
  );

  return (
    <div className="px-5 py-4 md:px-6">
      <div className="max-w-[1180px]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="heading-font text-[2.05rem] font-bold leading-none text-white">Tools</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Actions your AI agents can take for customers. Choose which agent uses which tools on the
              agent&apos;s <span className="text-white">Actions</span> tab; every call is logged in{" "}
              <Link href="/dashboard/logs?tab=actions" className="text-white underline-offset-2 hover:underline">
                Logs → Actions
              </Link>
              .
            </p>
          </div>
          {data.canManageHttp ? (
            <div className="relative">
              <button type="button" onClick={() => setShowTemplates((open) => !open)} aria-expanded={showTemplates} className={primaryButtonClass}>
                New tool
              </button>
              {showTemplates ? (
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-[#0d0d0d] p-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplates(false);
                      setDraft(blankDraft(defaultAgentIds));
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/5"
                  >
                    Blank HTTP tool
                    <span className="block text-xs text-slate-500">Call any HTTPS API</span>
                  </button>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Templates</p>
                  {data.templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setShowTemplates(false);
                        setDraft(draftFromTool(template.tool, null, defaultAgentIds));
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/5"
                    >
                      {template.label}
                      <span className="block truncate text-xs text-slate-500">
                        {template.tool.httpMethod} {template.tool.httpUrl.replace(/^https?:\/\//, "")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-4">
          {[
            { label: "Tools on", value: `${data.tools.filter((tool) => tool.isEnabled).length} / ${data.tools.length}` },
            { label: "Agents with actions", value: `${agentsWithActions.length} / ${data.agents.length}` },
            { label: "Calls (30 days)", value: String(totals.calls) },
            { label: "Success rate", value: totals.success + totals.errors ? `${Math.round((totals.success / (totals.success + totals.errors)) * 100)}%` : "—" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-3">
              <dt className="text-xs text-slate-500">{item.label}</dt>
              <dd className="mt-1 text-xl font-semibold text-white">{item.value}</dd>
            </div>
          ))}
        </dl>

        {agentsWithActions.length === 0 ? (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            No agent is allowed to take actions yet. Open an agent in{" "}
            <Link href="/dashboard/ai-agents" className="font-semibold underline-offset-2 hover:underline">
              AI Agents
            </Link>{" "}
            and switch on its <span className="font-semibold">Actions</span> tab.
          </p>
        ) : null}

        <div className="mt-4">
          <NoticeBox notice={notice} />
        </div>

        <div className="mt-6 space-y-6">
          <Card title="Built-in actions" description="Ready to use — they work with your tickets, contacts, leads, appointments and knowledge base.">
            <ul className="grid gap-3 lg:grid-cols-2">{builtIns.map(renderBuiltIn)}</ul>
          </Card>

          <Card
            title="Your systems"
            description={`Custom tools that call your own APIs — order tracking, invoices, CRM. ${custom.length}/${data.limits.customTools} used.`}
          >
            {custom.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">{custom.map(renderCustom)}</ul>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
                <p>No custom tools yet.</p>
                {data.canManageHttp ? (
                  <p className="mt-1">
                    Start from the <span className="text-white">Order tracking</span> or{" "}
                    <span className="text-white">Invoice generation</span> template — both work right away with the built-in demo store.
                  </p>
                ) : (
                  <p className="mt-1">Ask an admin to connect your systems.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      <TestDrawer tool={testing} onClose={() => setTesting(null)} onTested={replaceTool} />
      <BuiltInDrawer
        tool={editingBuiltIn}
        canManageHttp={data.canManageHttp}
        onClose={() => setEditingBuiltIn(null)}
        onSaved={(tool) => {
          replaceTool(tool);
          setNotice({ tone: "success", text: `Saved “${tool.name}”.` });
        }}
      />
      <HttpToolDrawer
        draft={draft}
        setDraft={setDraft}
        agents={data.agents}
        methods={data.methods}
        onClose={() => setDraft(null)}
        onSaved={(tool, created) => {
          setDraft(null);
          setData((current) =>
            current
              ? { ...current, tools: created ? [...current.tools, tool] : current.tools.map((item) => (item.id === tool.id ? { ...tool, stats: item.stats } : item)) }
              : current,
          );
          setNotice({ tone: "success", text: created ? `Created “${tool.name}”. Run a test to check the connection.` : `Saved “${tool.name}”.` });
          if (created) setTesting(tool);
        }}
      />
    </div>
  );
}
