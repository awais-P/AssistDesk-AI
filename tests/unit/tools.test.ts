import { describe, expect, it } from "vitest";
import {
  computeFreeSlots,
  isBookableSlot,
  parseAppointmentHours,
  zonedTimeToUtc,
} from "@/src/lib/tools/appointments-math";
import {
  detectConfirmation,
  parseToolHeaders,
  parseToolParameters,
  pickResponseFields,
  renderBodyTemplate,
  renderUrlTemplate,
  sanitizeToolKey,
  templatePlaceholders,
  toJsonSchema,
  trimForModel,
  validateToolInput,
} from "@/src/lib/tools/tool-schema";
import { validateHttpToolUrl } from "@/src/lib/tools/http-tool";

describe("tool definitions (FE-2b custom actions, FE-3)", () => {
  it("never lets tool inputs choose the server (no placeholders in the host)", async () => {
    for (const template of ["https://{shop}.example.com/orders", "https://api.example.com{path}", "https://user:{token}@api.example.com/x", "https://api.example.com:{port}/x"]) {
      const result = await validateHttpToolUrl(template, ["shop", "path", "token", "port"]);
      expect(result.ok, template).toBe(false);
    }

    expect(await validateHttpToolUrl("https://api.example.com/orders/{missing}", [])).toMatchObject({ ok: false, error: expect.stringContaining("{missing}") });
    expect(await validateHttpToolUrl("ftp://api.example.com/x", [])).toMatchObject({ ok: false });
  });

  it("sanitises tool keys", () => {
    expect(sanitizeToolKey("Track Order!")).toBe("track_order");
    expect(sanitizeToolKey("  get-invoice  ")).toBe("get_invoice");
    expect(sanitizeToolKey("x")).toBeNull();
    expect(sanitizeToolKey("123abc")).toBeNull();
  });

  it("sanitises parameters: names, duplicates, types, enums, reserved 'reason'", () => {
    const parameters = parseToolParameters([
      { name: "Order Number", type: "string", description: "The order number", required: true },
      { name: "order_number", type: "string" },
      { name: "reason", type: "string" },
      { name: "priority", type: "string", enum: ["low", "high", "high"] },
      { name: "count", type: "weird" },
    ]);

    expect(parameters.map((parameter) => parameter.name)).toEqual(["order_number", "priority", "count"]);
    expect(parameters[1].enum).toEqual(["low", "high"]);
    expect(parameters[2].type).toBe("string");
  });

  it("builds a JSON schema with the required reason field", () => {
    const schema = toJsonSchema([{ name: "order_number", type: "string", description: "Order", required: true }]);
    expect(schema.required).toEqual(["order_number", "reason"]);
    expect(schema.properties.reason.type).toBe("string");
    expect(schema.additionalProperties).toBe(false);
  });

  it("validates and coerces the model's arguments", () => {
    const parameters = parseToolParameters([
      { name: "order_number", type: "string", required: true },
      { name: "quantity", type: "integer" },
      { name: "gift", type: "boolean" },
      { name: "size", type: "string", enum: ["S", "M"] },
    ]);

    expect(validateToolInput(parameters, { order_number: 1042, quantity: "3", gift: "true", reason: " customer asked " })).toEqual({
      ok: true,
      values: { order_number: "1042", quantity: 3, gift: true },
      reason: "customer asked",
    });

    const bad = validateToolInput(parameters, { quantity: "2.5", gift: "maybe", size: "XL" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(4);
  });
});

describe("HTTP templates", () => {
  it("URL-encodes placeholders so inputs cannot change the path", () => {
    expect(renderUrlTemplate("https://shop.example.com/orders/{order_number}?lang={lang}", { order_number: "10 42/../admin", lang: "en" })).toBe(
      "https://shop.example.com/orders/10%2042%2F..%2Fadmin?lang=en",
    );
  });

  it("fills JSON body templates with typed values", () => {
    expect(renderBodyTemplate('{"order": "{order_number}", "qty": "{quantity}", "note": "Order {order_number} please"}', { order_number: "1042", quantity: 3 })).toEqual({
      order: "1042",
      qty: 3,
      note: "Order 1042 please",
    });
    expect(renderBodyTemplate("", { a: 1 })).toEqual({ a: 1 });
    expect(() => renderBodyTemplate("{not json", {})).toThrow();
    expect(templatePlaceholders("/orders/{order_number}/{x}")).toEqual(["order_number", "x"]);
  });

  it("keeps only configured response fields and trims large results", () => {
    const response = { order: { status: "Shipped", items: [{ name: "Kettle" }], secret: "x" } };
    expect(pickResponseFields(response, ["order.status", "order.items.0.name", "order.missing"])).toEqual({
      "order.status": "Shipped",
      "order.items.0.name": "Kettle",
      "order.missing": null,
    });
    expect(trimForModel({ text: "x".repeat(5000) }, 100)).toMatchObject({ truncated: true });
  });

  it("marks sensitive headers as secret and drops forbidden ones", () => {
    const headers = parseToolHeaders([
      { name: "Authorization", value: "Bearer abc" },
      { name: "X-Shop", value: "kettles" },
      { name: "Host", value: "evil" },
      { name: "bad header", value: "x" },
    ]);
    expect(headers).toEqual([
      { name: "Authorization", value: "Bearer abc", secret: true },
      { name: "X-Shop", value: "kettles", secret: false },
    ]);
  });
});

describe("confirmations for risky actions", () => {
  it("understands yes and no in English and Roman Urdu", () => {
    for (const yes of ["Yes please", "ok", "Go ahead", "haan kar do", "ji bilkul", "sure, book it", "why not", "kyun nahi"]) {
      expect(detectConfirmation(yes)).toBe("YES");
    }

    for (const no of ["No", "cancel it", "don't book", "nahi", "not now", "ji nahi", "wait"]) {
      expect(detectConfirmation(no)).toBe("NO");
    }

    expect(detectConfirmation("what time is it in Lahore?")).toBeNull();
  });
});

describe("appointment slots (FE-1 booking)", () => {
  const timeZone = "Asia/Karachi";
  const hours = parseAppointmentHours({ days: [1, 2, 3, 4, 5], start: "09:00", end: "11:00" });

  it("converts local business hours to exact instants", () => {
    // 09:00 in Karachi (UTC+5) is 04:00 UTC.
    expect(zonedTimeToUtc(2026, 10, 5, 9, 0, timeZone).toISOString()).toBe("2026-10-05T04:00:00.000Z");
    // London switches from BST to GMT on 25 Oct 2026.
    expect(zonedTimeToUtc(2026, 10, 24, 9, 0, "Europe/London").toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(zonedTimeToUtc(2026, 10, 26, 9, 0, "Europe/London").toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("offers free slots in business hours, skipping weekends, bookings and the next hour", () => {
    // Saturday 3 Oct 2026, 12:00 Karachi.
    const now = new Date("2026-10-03T07:00:00Z");
    const slots = computeFreeSlots({
      hours,
      slotMinutes: 30,
      timeZone,
      now,
      daysAhead: 7,
      booked: [{ startsAt: new Date("2026-10-05T04:30:00Z"), durationMinutes: 30 }],
    });

    expect(slots.map((slot) => slot.startsAt).slice(0, 4)).toEqual([
      "2026-10-05T04:00:00.000Z",
      "2026-10-05T05:00:00.000Z",
      "2026-10-05T05:30:00.000Z",
      "2026-10-06T04:00:00.000Z",
    ]);
    expect(slots[0].label).toBe("Mon 5 Oct, 09:00");
  });

  it("can search one specific day", () => {
    const slots = computeFreeSlots({ hours, slotMinutes: 60, timeZone, now: new Date("2026-10-03T07:00:00Z"), daysAhead: 14, booked: [], date: "2026-10-07" });
    expect(slots.map((slot) => slot.label)).toEqual(["Wed 7 Oct, 09:00", "Wed 7 Oct, 10:00"]);
  });

  it("validates a requested slot", () => {
    const base = { hours, slotMinutes: 30, timeZone, now: new Date("2026-10-03T07:00:00Z"), daysAhead: 14, booked: [] };
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-10-05T04:00:00Z") }).ok).toBe(true);
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-10-04T04:00:00Z") }).ok).toBe(false); // Sunday
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-10-05T04:10:00Z") }).ok).toBe(false); // misaligned
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-10-05T07:00:00Z") }).ok).toBe(false); // 12:00, after hours
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-11-30T04:00:00Z") }).ok).toBe(false); // too far ahead
    expect(isBookableSlot({ ...base, startsAt: new Date("2026-10-05T04:00:00Z"), booked: [{ startsAt: new Date("2026-10-05T04:00:00Z"), durationMinutes: 30 }] }).ok).toBe(false);
  });
});

describe("intent → action rules (FE-4)", async () => {
  const { forcedToolFor, intentRuleInstructions, matchIntentRules, parseIntentRules } = await import("@/src/lib/agent-engine/intent-rules");
  const rules = parseIntentRules(
    [
      { id: "r1", phrases: ["Where is my order", "track my order", "x"], toolKey: "track_order", mode: "ALWAYS" },
      { id: "r2", phrases: ["book", "appointment"], toolKey: "check_availability", mode: "PREFER" },
      { id: "r3", phrases: ["invoice"], toolKey: "unknown_tool" },
      { phrases: [], toolKey: "create_ticket" },
    ],
    ["track_order", "check_availability", "create_ticket"],
  );

  it("drops rules without phrases or for unavailable tools", () => {
    expect(rules.map((rule) => rule.id)).toEqual(["r1", "r2"]);
    expect(rules[0].phrases).toEqual(["where is my order", "track my order"]);
  });

  it("matches whole words only and picks the forced tool", () => {
    expect(matchIntentRules("Hi, where is my order #1042?", rules).map((rule) => rule.id)).toEqual(["r1"]);
    expect(matchIntentRules("I want to book an appointment", rules).map((rule) => rule.id)).toEqual(["r2"]);
    expect(matchIntentRules("I read a facebook post", rules)).toEqual([]);
    expect(forcedToolFor(matchIntentRules("track my order please", rules))).toBe("track_order");
    expect(forcedToolFor(matchIntentRules("book a demo", rules))).toBeNull();
  });

  it("explains the rules to the model", () => {
    const text = intentRuleInstructions(rules, matchIntentRules("where is my order", rules)) ?? "";
    expect(text).toContain("use the track_order tool");
    expect(text).toContain("This message matches: track_order");
    expect(intentRuleInstructions([], [])).toBeNull();
  });
});

describe("answers from tool results when no model can reply", async () => {
  const { summarizeToolResults } = await import("@/src/lib/agent-engine/tool-summary");
  const entry = (toolKey: string, output: unknown, status = "SUCCESS") => ({ type: "tool" as const, step: 1, toolKey, toolName: toolKey, input: {}, output, status, reason: null, executionId: null });

  it("phrases built-in results for the customer", () => {
    expect(summarizeToolResults([entry("lookup_ticket_status", { found: true, reference: "AD-1", subject: "Kettle", status: "IN_PROGRESS" })])).toBe(
      'Your ticket AD-1 ("Kettle") is in progress — our team is working on it.',
    );
    expect(summarizeToolResults([entry("check_availability", { slots: [{ label: "Mon 5 Oct, 09:00" }, { label: "Mon 5 Oct, 09:30" }] })])).toContain("Mon 5 Oct, 09:00, Mon 5 Oct, 09:30");
    expect(summarizeToolResults([entry("create_ticket", { created: true, reference: "AD-9", followUp: "The team will reply by email." })])).toBe("I've opened ticket AD-9 for you. The team will reply by email.");
  });

  it("asks the pending confirmation question and ignores failures and lookups", () => {
    const pending = entry("book_appointment", { instruction: 'Do not say it is done. Ask the customer to confirm: "Book an appointment on Mon 5 Oct, 09:00 for Ali. Shall I go ahead?" It will run…' }, "PENDING_CONFIRMATION");
    expect(summarizeToolResults([pending])).toBe("Book an appointment on Mon 5 Oct, 09:00 for Ali. Shall I go ahead?");
    expect(summarizeToolResults([entry("track_order", { error: "down" }, "ERROR"), entry("get_customer_info", { known: true })])).toBeNull();
  });

  it("shows the main fields of custom HTTP tools", () => {
    expect(summarizeToolResults([entry("track_order", { "order.status": "SHIPPED", "order.eta": "2026-10-06" })])).toBe("Here's what I found: status: SHIPPED; eta: 2026-10-06.");
  });
});

describe("chain of thought for the action log (FE-5)", async () => {
  const { buildRunTrace, parseRunTrace, traceExecutionIds } = await import("@/src/lib/agent-engine/run-trace");
  const base = { confirmation: { state: "NONE" as const }, matchedRules: [], forcedTool: null, graphTrace: [], graphError: null, fallback: null, escalation: null };

  it("records decisions in order, with actions by execution id", () => {
    const trace = buildRunTrace({
      ...base,
      confirmation: { state: "EXECUTED", summary: "Book Mon 09:00", toolName: "Book appointment", toolKey: "book_appointment", executionId: "ex1", status: "SUCCESS", output: {} },
      matchedRules: [{ id: "r", phrases: ["where is my order", "track", "order status", "parcel"], toolKey: "track_order", mode: "ALWAYS" }],
      forcedTool: "track_order",
      graphTrace: [
        { type: "model_error", step: 1, model: "a/model", error: "429" },
        { type: "tool", step: 1, toolKey: "track_order", toolName: "Track order", input: { order_number: "1" }, output: { status: "SHIPPED" }, status: "SUCCESS", reason: "Customer asked", executionId: "ex2" },
        { type: "thought", step: 2, text: "   " },
        { type: "thought", step: 2, text: "The order is shipped." },
      ],
      fallback: { type: "fallback", kind: "tool_results", detail: "composed" },
    });

    expect(trace.map((entry) => entry.type)).toEqual(["confirmation", "intent", "model_error", "tool", "thought", "fallback"]);
    expect(trace[1]).toEqual({ type: "intent", rules: [{ toolKey: "track_order", mode: "ALWAYS", phrases: ["where is my order", "track", "order status"] }], forcedTool: "track_order" });
    // Inputs and outputs stay on the execution row, not in the trace.
    expect(trace[3]).not.toHaveProperty("input");
    expect(traceExecutionIds(trace)).toEqual(["ex1", "ex2"]);
  });

  it("caps long traces but keeps the ending, and reads stored traces defensively", () => {
    const thoughts = Array.from({ length: 80 }, (_, index) => ({ type: "thought" as const, step: index, text: `t${index}` }));
    const trace = buildRunTrace({ ...base, graphTrace: thoughts, escalation: "Handed over" });
    expect(trace).toHaveLength(60);
    expect(trace.at(-1)).toMatchObject({ type: "escalation" });
    expect(parseRunTrace(null)).toEqual([]);
    expect(parseRunTrace([{ type: "thought", step: 1, text: "ok" }, { type: "evil" }, null, "x"])).toEqual([{ type: "thought", step: 1, text: "ok" }]);
  });
});

describe("action usage report (Module 2 × Module 4)", async () => {
  const { summarizeToolUsage } = await import("@/src/lib/analytics-math");

  it("counts outcomes per action and times only finished calls", () => {
    const rows = [
      { toolKey: "track_order", toolName: "Track order v2", status: "SUCCESS", latencyMs: 100 },
      { toolKey: "track_order", toolName: "Track order", status: "SUCCESS", latencyMs: 300 },
      { toolKey: "track_order", toolName: "Track order", status: "ERROR", latencyMs: 2000 },
      { toolKey: "track_order", toolName: "Track order", status: "DENIED", latencyMs: 0 },
      { toolKey: "book_appointment", toolName: "Book appointment", status: "PENDING_CONFIRMATION", latencyMs: 0 },
    ];
    const [track, book] = summarizeToolUsage(rows);

    expect(track).toMatchObject({ key: "track_order", name: "Track order v2", calls: 4, success: 2, failed: 1, declined: 1, pending: 0, avgLatencyMs: 800, p95LatencyMs: 2000 });
    expect(track.successRate).toBeCloseTo(2 / 3);
    expect(book).toMatchObject({ calls: 1, pending: 1, successRate: null, avgLatencyMs: null });
    expect(summarizeToolUsage([])).toEqual([]);
  });
});

describe("retired models are skipped by the fallback chain", async () => {
  const health = await import("@/src/lib/model-health");

  it("treats 404 / not-available as retired, but not rate limits", () => {
    health.resetModelHealthForTests();
    expect(health.recordModelFailure("openrouter/qwen/qwen3.8-27b:free", "404 This model is unavailable for free.")).toBe(true);
    expect(health.recordModelFailure("openrouter/google/gemma-4-31b-it:free", "429 Provider returned error")).toBe(false);
    expect(health.recordModelFailure("x/timeout", "Request timed out after 15000 ms")).toBe(false);
    expect(health.withoutGoneModels(["a", "openrouter/qwen/qwen3.8-27b:free", "b"], (id) => id)).toEqual(["a", "b"]);
  });

  it("never empties a chain and forgets retirements after 6 hours", () => {
    health.resetModelHealthForTests();
    const now = Date.now();
    health.markModelGone("only/model", "404", now);
    expect(health.withoutGoneModels(["only/model"], (id) => id)).toEqual(["only/model"]);
    expect(health.isModelGone("only/model", now + 5 * 60 * 60 * 1000)).toBe(true);
    expect(health.isModelGone("only/model", now + 7 * 60 * 60 * 1000)).toBe(false);
  });

  it("removes library boilerplate from errors", () => {
    expect(health.cleanModelError("429 Provider returned error Troubleshooting URL: https://docs.langchain.com/x/ ")).toBe("429 Provider returned error");
  });
});
