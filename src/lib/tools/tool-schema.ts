/**
 * Module 2 tool definitions: parameter schemas, input validation, HTTP templates,
 * response trimming and confirmation replies. Pure functions (no database), shared by
 * the registry, the reasoning engine, the admin UI and the unit tests.
 */

export type ToolParameterType = "string" | "number" | "integer" | "boolean";

export type ToolParameter = {
  name: string;
  type: ToolParameterType;
  description: string;
  required: boolean;
  enum?: string[];
};

export const TOOL_PARAMETER_TYPES: ToolParameterType[] = ["string", "number", "integer", "boolean"];
export const MAX_TOOL_PARAMETERS = 10;
export const MAX_TOOL_OUTPUT_CHARS = 4000;
/** Every tool call carries the model's reason, which becomes the action log's "chain of thought". */
export const REASON_PARAMETER = "reason";

const KEY_PATTERN = /^[a-z][a-z0-9_]{2,39}$/;

/** "Track Order!" → "track_order". Returns null when nothing usable remains. */
export function sanitizeToolKey(value: unknown) {
  const key = (typeof value === "string" ? value : "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  return KEY_PATTERN.test(key) ? key : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Sanitises an admin-defined parameter list (names unique, snake_case, max 10). */
export function parseToolParameters(raw: unknown): ToolParameter[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const parameters: ToolParameter[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const entry = item as Record<string, unknown>;
    const name = (text(entry.name, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")) || "";

    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || name === REASON_PARAMETER || seen.has(name)) {
      continue;
    }

    seen.add(name);
    const type = TOOL_PARAMETER_TYPES.includes(entry.type as ToolParameterType) ? (entry.type as ToolParameterType) : "string";
    const options = Array.isArray(entry.enum)
      ? [...new Set(entry.enum.map((option) => text(option, 60)).filter(Boolean))].slice(0, 20)
      : [];

    parameters.push({
      name,
      type,
      description: text(entry.description, 300) || name.replace(/_/g, " "),
      required: entry.required === true,
      ...(type === "string" && options.length >= 2 ? { enum: options } : {}),
    });

    if (parameters.length >= MAX_TOOL_PARAMETERS) {
      break;
    }
  }

  return parameters;
}

/** OpenAI-style JSON Schema for the model, with the extra "reason" field. */
export function toJsonSchema(parameters: ToolParameter[], { withReason = true } = {}) {
  const properties: Record<string, Record<string, unknown>> = {};

  for (const parameter of parameters) {
    properties[parameter.name] = {
      type: parameter.type,
      description: parameter.description,
      ...(parameter.enum ? { enum: parameter.enum } : {}),
    };
  }

  if (withReason) {
    properties[REASON_PARAMETER] = {
      type: "string",
      description: "One short sentence: why you are calling this tool now. Shown to the support team in the action log.",
    };
  }

  return {
    type: "object",
    properties,
    required: [...parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name), ...(withReason ? [REASON_PARAMETER] : [])],
    additionalProperties: false,
  };
}

export type ToolInputValues = Record<string, string | number | boolean>;

export type ToolInputResult =
  | { ok: true; values: ToolInputValues; reason: string | null }
  | { ok: false; errors: string[] };

/** Validates and coerces the model's arguments (strings → numbers/booleans, enums, required). */
export function validateToolInput(parameters: ToolParameter[], raw: unknown): ToolInputResult {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const values: ToolInputValues = {};
  const errors: string[] = [];

  for (const parameter of parameters) {
    const value = input[parameter.name];

    if (value === undefined || value === null || value === "") {
      if (parameter.required) {
        errors.push(`"${parameter.name}" is required.`);
      }
      continue;
    }

    if (parameter.type === "string") {
      const stringValue = typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : null;

      if (stringValue === null || !stringValue) {
        errors.push(`"${parameter.name}" must be text.`);
      } else if (parameter.enum && !parameter.enum.includes(stringValue)) {
        errors.push(`"${parameter.name}" must be one of: ${parameter.enum.join(", ")}.`);
      } else {
        values[parameter.name] = stringValue.slice(0, 2000);
      }
    } else if (parameter.type === "number" || parameter.type === "integer") {
      const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;

      if (!Number.isFinite(numberValue) || (parameter.type === "integer" && !Number.isInteger(numberValue))) {
        errors.push(`"${parameter.name}" must be ${parameter.type === "integer" ? "a whole number" : "a number"}.`);
      } else {
        values[parameter.name] = numberValue;
      }
    } else {
      const booleanValue = typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : null;

      if (booleanValue === null) {
        errors.push(`"${parameter.name}" must be true or false.`);
      } else {
        values[parameter.name] = booleanValue;
      }
    }
  }

  const reason = typeof input[REASON_PARAMETER] === "string" ? (input[REASON_PARAMETER] as string).trim().slice(0, 500) || null : null;

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values, reason };
}

/** Fills {param} placeholders in a URL; values are URL-encoded, unknown ones become "". */
export function renderUrlTemplate(template: string, values: ToolInputValues) {
  return template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_match, name: string) =>
    values[name] === undefined ? "" : encodeURIComponent(String(values[name])),
  );
}

/**
 * Fills a JSON body template. A string that is exactly "{param}" becomes the typed
 * value; placeholders inside longer strings are interpolated. An empty template
 * sends all inputs as a JSON object. Throws on an invalid template.
 */
export function renderBodyTemplate(template: string | null | undefined, values: ToolInputValues) {
  if (!template || !template.trim()) {
    return values;
  }

  const parsed = JSON.parse(template) as unknown;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const exact = node.match(/^\{([a-z][a-z0-9_]*)\}$/);

      if (exact) {
        return values[exact[1]] ?? null;
      }

      return node.replace(/\{([a-z][a-z0-9_]*)\}/g, (_match, name: string) => (values[name] === undefined ? "" : String(values[name])));
    }

    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
    }

    return node;
  };

  return walk(parsed);
}

/** Placeholders used in a template, to check they match the parameters. */
export function templatePlaceholders(template: string | null | undefined) {
  return [...new Set([...(template ?? "").matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1]))];
}

/** Reads a dot path ("order.items.0.name") from a JSON value. */
export function readPath(value: unknown, path: string) {
  let current: unknown = value;

  for (const segment of path.split(".").filter(Boolean)) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

/** Keeps only the configured fields of a response (all of it when none are set). */
export function pickResponseFields(value: unknown, paths: string[]) {
  if (paths.length === 0) {
    return value;
  }

  return Object.fromEntries(paths.map((path) => [path, readPath(value, path) ?? null]));
}

/** A JSON-safe, size-limited copy of a tool result for the model and the log. */
export function trimForModel(value: unknown, maxChars = MAX_TOOL_OUTPUT_CHARS) {
  let json: string;

  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    json = JSON.stringify(String(value));
  }

  if (json.length <= maxChars) {
    return JSON.parse(json) as unknown;
  }

  return { truncated: true, preview: json.slice(0, maxChars) };
}

/**
 * The customer's answer to "Shall I go ahead?" (English and Roman Urdu). Negations
 * win ("no, don't book it"); anything unclear returns null and the action stays pending.
 */
export function detectConfirmation(message: string): "YES" | "NO" | null {
  const content = message.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

  if (!content) {
    return null;
  }

  // "why not" / "kyun nahi" mean yes, even though they contain a negation.
  if (/\b(why not|kyun nahi|kyun nahin|kyon nahi|kyu nahi)\b/.test(content)) {
    return "YES";
  }

  if (/\b(no|not|nope|nah|cancel|don't|dont|do not|stop|not now|never mind|nevermind|wait|nahi|nahin|nai|mat|rehne do)\b/.test(content)) {
    return "NO";
  }

  if (/\b(yes|yeah|yep|yup|sure|confirm|confirmed|go ahead|ok|okay|please do|do it|book it|correct|right|haan|han|ji|jee|theek|thik|kar do|krdo|bilkul|zaroor)\b/.test(content) || /^(y|k)$/.test(content)) {
    return "YES";
  }

  return null;
}

export type ToolHeader = { name: string; value: string; secret: boolean };

/** Header names that never reach the action log or the UI in plain text. */
export function isSensitiveHeader(name: string) {
  return /authorization|api[-_]?key|token|secret|password|cookie/i.test(name);
}

export function parseToolHeaders(raw: unknown): ToolHeader[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      const name = text(entry.name, 80);
      return {
        name,
        value: typeof entry.value === "string" ? entry.value.slice(0, 2000) : "",
        secret: entry.secret === true || isSensitiveHeader(name),
      };
    })
    .filter((header) => /^[A-Za-z0-9-]{1,80}$/.test(header.name) && !/^(host|content-length|connection|transfer-encoding)$/i.test(header.name))
    .slice(0, 10);
}
