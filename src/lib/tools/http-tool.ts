import { UnsafeUrlError, assertPublicUrl } from "../safe-fetch";
import { decryptSecret } from "../secrets";
import {
  type ToolHeader,
  type ToolInputValues,
  parseToolHeaders,
  pickResponseFields,
  renderBodyTemplate,
  renderUrlTemplate,
  templatePlaceholders,
  trimForModel,
} from "./tool-schema";

/**
 * Module 2 custom actions (FE-2b): calls the customer's own system (order status,
 * invoices, CRM…) as described by an HTTP tool.
 *
 * - Inputs are URL-encoded into the URL template; GET inputs not in the URL become
 *   query parameters, other methods send a JSON body (template or all inputs).
 * - The target must resolve to a public address (SSRF), redirects are refused, the
 *   response is capped at 100 KB and the call times out (max 15 s).
 * - Secret headers are stored encrypted and never logged.
 * - Dry run (playground): reads (GET) run for real, writes are only described.
 */

const MAX_RESPONSE_BYTES = 100_000;
const MAX_TIMEOUT_MS = 15_000;

export type HttpToolConfig = {
  name: string;
  httpMethod: string | null;
  httpUrl: string | null;
  httpHeaders: unknown;
  httpBody: string | null;
  httpTimeoutMs: number;
  responseFields: string[];
};

export type HttpToolResult =
  | { ok: true; status: number; data: unknown; dryRun?: boolean }
  | { ok: false; status: number | null; error: string };

function allowPrivateTargets() {
  return process.env.NODE_ENV !== "production" && process.env.ASSISTDESK_ALLOW_PRIVATE_TOOLS === "true";
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Checks the URL template an admin saves (protocol, host, placeholders). */
export async function validateHttpToolUrl(template: string, parameterNames: string[]) {
  const unknown = templatePlaceholders(template).filter((name) => !parameterNames.includes(name));

  if (unknown.length > 0) {
    return { ok: false as const, error: `The URL uses ${unknown.map((name) => `{${name}}`).join(", ")}, which is not a parameter.` };
  }

  // Checked on the template itself: inputs must never choose which server is called.
  const authority = template.trim().match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";

  if (authority.includes("{") || authority.includes("}")) {
    return { ok: false as const, error: "Placeholders are not allowed in the host name." };
  }

  let url: URL;

  try {
    // Placeholders are replaced with a sample value only to check the host.
    url = new URL(template.replace(/\{[a-z][a-z0-9_]*\}/g, "x"));
  } catch {
    return { ok: false as const, error: "Enter a valid URL, like https://api.example.com/orders/{order_number}." };
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && process.env.NODE_ENV !== "production")) {
    return { ok: false as const, error: "Tool URLs must use https://." };
  }

  if (!allowPrivateTargets()) {
    try {
      await assertPublicUrl(url.toString());
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof UnsafeUrlError
            ? `This URL points to a local or private network address. Use a public API URL.${
                process.env.NODE_ENV !== "production" ? " (For local testing, set ASSISTDESK_ALLOW_PRIVATE_TOOLS=true in .env and restart.)" : ""
              }`
            : "This URL could not be checked.",
      };
    }
  }

  return { ok: true as const };
}

function headersFor(raw: unknown) {
  const headers: Record<string, string> = {};

  for (const header of parseToolHeaders(raw) as ToolHeader[]) {
    headers[header.name] = header.secret ? decryptSecret(header.value) ?? "" : header.value;
  }

  return headers;
}

async function readLimited(response: Response) {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    total += value.byteLength;

    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      chunks.push(value.subarray(0, value.byteLength - (total - MAX_RESPONSE_BYTES)));
      break;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** Builds the request (shared by execution, dry runs and the admin "Test" button). */
export function buildHttpRequest(tool: HttpToolConfig, values: ToolInputValues) {
  const method = (HTTP_METHODS as readonly string[]).includes(tool.httpMethod ?? "") ? (tool.httpMethod as string) : "GET";
  const template = tool.httpUrl ?? "";
  const url = new URL(renderUrlTemplate(template, values));
  const usedInUrl = new Set(templatePlaceholders(template));
  const rest = Object.fromEntries(Object.entries(values).filter(([name]) => !usedInUrl.has(name)));
  let body: string | undefined;

  if (method === "GET" || method === "DELETE") {
    for (const [name, value] of Object.entries(rest)) {
      url.searchParams.set(name, String(value));
    }
  } else {
    body = JSON.stringify(tool.httpBody?.trim() ? renderBodyTemplate(tool.httpBody, values) : rest);
  }

  return { method, url: url.toString(), body };
}

export async function executeHttpTool(tool: HttpToolConfig, values: ToolInputValues, { dryRun = false } = {}): Promise<HttpToolResult> {
  let request: ReturnType<typeof buildHttpRequest>;

  try {
    request = buildHttpRequest(tool, values);
  } catch (error) {
    return { ok: false, status: null, error: error instanceof SyntaxError ? "The tool's body template is not valid JSON." : "The tool URL is not valid." };
  }

  if (dryRun && request.method !== "GET") {
    return {
      ok: true,
      status: 0,
      dryRun: true,
      data: { simulated: true, note: `Test mode: ${tool.name} was not called.`, request: { method: request.method, url: request.url, body: request.body ? JSON.parse(request.body) : null } },
    };
  }

  if (!allowPrivateTargets()) {
    try {
      await assertPublicUrl(request.url);
    } catch {
      return { ok: false, status: null, error: "The tool URL points to a private address and was blocked." };
    }
  }

  let response: Response;

  try {
    response = await fetch(request.url, {
      method: request.method,
      headers: {
        Accept: "application/json",
        "User-Agent": "AssistDesk-Tools/1.0",
        ...(request.body ? { "Content-Type": "application/json" } : {}),
        ...headersFor(tool.httpHeaders),
      },
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(MAX_TIMEOUT_MS, Math.max(1000, tool.httpTimeoutMs))),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, status: null, error: timedOut ? "The system did not answer in time." : "The system could not be reached." };
  }

  const raw = await readLimited(response);
  let data: unknown = raw;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw.slice(0, 2000);
  }

  if (response.status >= 300 && response.status < 400) {
    return { ok: false, status: response.status, error: "The system answered with a redirect, which is not followed." };
  }

  if (!response.ok) {
    const detail = typeof data === "object" && data && "error" in data ? String((data as { error: unknown }).error) : typeof data === "string" ? data.slice(0, 200) : "";
    return { ok: false, status: response.status, error: `The system answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.` };
  }

  return { ok: true, status: response.status, data: trimForModel(pickResponseFields(data, tool.responseFields)) };
}
