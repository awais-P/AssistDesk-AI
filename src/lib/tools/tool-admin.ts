import type { AgentTool, Prisma } from "@/app/generated/prisma/client";
import { getAppUrl } from "../llm-runtime";
import { prisma } from "../prisma";
import { decryptSecret, encryptSecret } from "../secrets";
import { BUILT_IN_BY_KEY, BUILT_IN_TOOLS } from "./builtin-tools";
import { HTTP_METHODS, validateHttpToolUrl } from "./http-tool";
import { SAMPLE_STORE_KEY } from "../sample-store";
import {
  type ToolHeader,
  type ToolParameter,
  parseToolHeaders,
  parseToolParameters,
  renderBodyTemplate,
  sanitizeToolKey,
  templatePlaceholders,
} from "./tool-schema";

/**
 * Module 2 FE-3: administering tools — serialising for the dashboard (secrets masked),
 * validating custom HTTP tools, and ready-made templates.
 */

export const MAX_CUSTOM_TOOLS = 30;

const builtInOrder = new Map(BUILT_IN_TOOLS.map((tool, index) => [tool.key, index]));

/** Built-in actions in their documented order, then custom tools oldest first. */
export function sortTools<T extends { type: string; builtInKey: string | null; createdAt: Date }>(tools: T[]) {
  return [...tools].sort((a, b) => {
    if (a.type !== b.type) return a.type === "BUILT_IN" ? -1 : 1;
    if (a.type === "BUILT_IN") return (builtInOrder.get(a.builtInKey ?? "") ?? 99) - (builtInOrder.get(b.builtInKey ?? "") ?? 99);
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function maskHeaderValue(value: string) {
  const plain = decryptSecret(value) ?? "";
  return plain ? `••••${plain.slice(-4)}` : "";
}

export function serializeTool(
  row: AgentTool & { bindings?: Array<{ agentId: string }> },
  stats?: { calls: number; success: number; errors: number; avgLatencyMs: number | null },
) {
  const builtIn = row.builtInKey ? BUILT_IN_BY_KEY.get(row.builtInKey) : null;
  const headers = parseToolHeaders(row.httpHeaders);

  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    defaultDescription: builtIn?.description ?? null,
    type: row.type,
    builtInKey: row.builtInKey,
    effect: builtIn ? builtIn.effect : (row.httpMethod ?? "GET") === "GET" ? "READ" : "WRITE",
    parameters: builtIn ? builtIn.parameters : parseToolParameters(row.parameters),
    httpMethod: row.httpMethod,
    httpUrl: row.httpUrl,
    httpHeaders: headers.map((header) => ({ name: header.name, secret: header.secret, value: header.secret ? maskHeaderValue(header.value) : header.value })),
    httpBody: row.httpBody,
    httpTimeoutMs: row.httpTimeoutMs,
    responseFields: row.responseFields,
    requiresConfirmation: row.requiresConfirmation,
    isEnabled: row.isEnabled,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    agentIds: row.bindings?.map((binding) => binding.agentId) ?? [],
    stats: stats ?? { calls: 0, success: 0, errors: 0, avgLatencyMs: null },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type SerializedTool = ReturnType<typeof serializeTool>;

export async function toolStats(workspaceId: string, since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
  const groups = await prisma.toolExecution.groupBy({
    by: ["toolId", "status"],
    // Customer-facing calls only: no admin tests or Playground runs.
    where: { workspaceId, createdAt: { gte: since }, triggeredBy: { not: "TEST" }, NOT: { run: { is: { source: "PLAYGROUND" } } } },
    _count: { _all: true },
    _avg: { latencyMs: true },
  });
  const stats = new Map<string, { calls: number; success: number; errors: number; latencySum: number; latencyCount: number }>();

  for (const group of groups) {
    if (!group.toolId) continue;
    const entry = stats.get(group.toolId) ?? { calls: 0, success: 0, errors: 0, latencySum: 0, latencyCount: 0 };
    entry.calls += group._count._all;
    if (group.status === "SUCCESS") entry.success += group._count._all;
    if (group.status === "ERROR") entry.errors += group._count._all;
    if (group.status === "SUCCESS" || group.status === "ERROR") {
      entry.latencySum += (group._avg.latencyMs ?? 0) * group._count._all;
      entry.latencyCount += group._count._all;
    }
    stats.set(group.toolId, entry);
  }

  return new Map(
    [...stats.entries()].map(([toolId, entry]) => [
      toolId,
      { calls: entry.calls, success: entry.success, errors: entry.errors, avgLatencyMs: entry.latencyCount ? Math.round(entry.latencySum / entry.latencyCount) : null },
    ]),
  );
}

export type HttpToolInput = {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
  httpMethod?: unknown;
  httpUrl?: unknown;
  httpHeaders?: unknown;
  httpBody?: unknown;
  httpTimeoutMs?: unknown;
  responseFields?: unknown;
  requiresConfirmation?: unknown;
  isEnabled?: unknown;
};

type ValidHttpTool = {
  key: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  httpMethod: string;
  httpUrl: string;
  httpHeaders: ToolHeader[];
  httpBody: string | null;
  httpTimeoutMs: number;
  responseFields: string[];
  requiresConfirmation: boolean;
  isEnabled: boolean;
};

/**
 * Validates a custom HTTP tool. `existingHeaders` (on edit) keeps stored secret values
 * when the dashboard sends an empty value for a secret header.
 */
export async function validateHttpTool(
  input: HttpToolInput,
  { existingHeaders = null, existingKey = null }: { existingHeaders?: unknown; existingKey?: string | null } = {},
): Promise<{ ok: true; value: ValidHttpTool } | { ok: false; error: string }> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 1000) : "";
  const key = existingKey ?? sanitizeToolKey(typeof input.key === "string" && input.key ? input.key : name);
  const method = typeof input.httpMethod === "string" ? input.httpMethod.toUpperCase() : "GET";
  const url = typeof input.httpUrl === "string" ? input.httpUrl.trim().slice(0, 1000) : "";
  const parameters = parseToolParameters(input.parameters);
  const body = typeof input.httpBody === "string" && input.httpBody.trim() ? input.httpBody.trim().slice(0, 4000) : null;

  if (!name) return { ok: false, error: "Give the tool a name, like \"Track order\"." };
  if (!key) return { ok: false, error: "The tool name must contain letters (it becomes the tool's id, like track_order)." };
  if (BUILT_IN_BY_KEY.has(key) && !existingKey) return { ok: false, error: `"${key}" is a built-in tool name. Choose another name.` };
  if (description.length < 15) return { ok: false, error: "Describe what the tool does and when the AI should use it (at least 15 characters). The AI reads this to decide." };
  if (!(HTTP_METHODS as readonly string[]).includes(method)) return { ok: false, error: `Method must be one of ${HTTP_METHODS.join(", ")}.` };

  const urlCheck = await validateHttpToolUrl(url, parameters.map((parameter) => parameter.name));
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };

  if (body) {
    if (method === "GET" || method === "DELETE") return { ok: false, error: "GET and DELETE tools send their inputs in the URL; remove the body template." };

    try {
      renderBodyTemplate(body, {});
    } catch {
      return { ok: false, error: "The body template must be valid JSON, like {\"order\": \"{order_number}\"}." };
    }

    const unknown = templatePlaceholders(body).filter((placeholder) => !parameters.some((parameter) => parameter.name === placeholder));
    if (unknown.length) return { ok: false, error: `The body uses ${unknown.map((placeholder) => `{${placeholder}}`).join(", ")}, which is not a parameter.` };
  }

  const stored = parseToolHeaders(existingHeaders);
  const headers = parseToolHeaders(input.httpHeaders).map((header) => {
    if (!header.secret) return header;
    // An empty or masked value means "keep the stored secret".
    if (!header.value || header.value.startsWith("••••")) {
      const previous = stored.find((item) => item.name.toLowerCase() === header.name.toLowerCase() && item.secret);
      return { ...header, value: previous?.value ?? "" };
    }
    return { ...header, value: encryptSecret(header.value) ?? header.value };
  });

  const responseFields = Array.isArray(input.responseFields)
    ? [...new Set(input.responseFields.filter((field): field is string => typeof field === "string").map((field) => field.trim()).filter((field) => /^[A-Za-z0-9_.-]{1,80}$/.test(field)))].slice(0, 10)
    : [];
  const timeout = Number(input.httpTimeoutMs);

  return {
    ok: true,
    value: {
      key,
      name,
      description,
      parameters,
      httpMethod: method,
      httpUrl: url,
      httpHeaders: headers,
      httpBody: body,
      httpTimeoutMs: Number.isFinite(timeout) ? Math.min(15_000, Math.max(1000, Math.round(timeout))) : 10_000,
      responseFields,
      // Writes ask the customer first unless the admin decides otherwise.
      requiresConfirmation: typeof input.requiresConfirmation === "boolean" ? input.requiresConfirmation : method !== "GET",
      isEnabled: input.isEnabled !== false,
    },
  };
}

export function httpToolData(value: ValidHttpTool) {
  return {
    ...value,
    parameters: value.parameters as unknown as Prisma.InputJsonValue,
    httpHeaders: value.httpHeaders as unknown as Prisma.InputJsonValue,
  };
}

/** Ready-made HTTP tools (FE-1 order tracking and invoices) pointing at the sample store. */
export function httpToolTemplates() {
  const base = getAppUrl();

  return [
    {
      id: "order_tracking",
      label: "Order tracking",
      tool: {
        name: "Track order",
        description: "Get the delivery status, carrier and estimated delivery date of a customer's order from its order number. Use it whenever the customer asks where their order is.",
        parameters: [{ name: "order_number", type: "string", description: "The order number, e.g. 1042.", required: true }],
        httpMethod: "GET",
        httpUrl: `${base}/api/sample-store/orders/{order_number}`,
        httpHeaders: [{ name: "Authorization", value: `Bearer ${SAMPLE_STORE_KEY}`, secret: true }],
        responseFields: ["status", "estimatedDelivery", "deliveredOn", "carrier", "trackingNumber", "items"],
        requiresConfirmation: false,
      },
    },
    {
      id: "invoice",
      label: "Invoice generation",
      tool: {
        name: "Generate invoice",
        description: "Create an invoice for one of the customer's orders and return the invoice number and total. Use it when the customer asks for an invoice or receipt.",
        parameters: [{ name: "order_number", type: "string", description: "The order number to invoice.", required: true }],
        httpMethod: "POST",
        httpUrl: `${base}/api/sample-store/invoices`,
        httpHeaders: [{ name: "Authorization", value: `Bearer ${SAMPLE_STORE_KEY}`, secret: true }],
        httpBody: '{"order_number": "{order_number}"}',
        responseFields: ["invoiceNumber", "total", "currency", "issuedOn"],
        requiresConfirmation: true,
      },
    },
    {
      id: "crm_lookup",
      label: "CRM customer lookup (your API)",
      tool: {
        name: "CRM lookup",
        description: "Look up the customer's account in our CRM by email to see their plan and account manager. Use it when the customer asks about their account or plan.",
        parameters: [{ name: "email", type: "string", description: "Customer email.", required: true }],
        httpMethod: "GET",
        httpUrl: "https://api.your-crm.example.com/customers?email={email}",
        httpHeaders: [{ name: "Authorization", value: "", secret: true }],
        responseFields: [],
        requiresConfirmation: false,
      },
    },
  ];
}
