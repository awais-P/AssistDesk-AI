import { describe, expect, it } from "vitest";
import { changedFields, redactMetadata } from "@/src/lib/audit";
import { parseAuditFilters } from "@/src/lib/audit-queries";
import { can, effectivePermissions, roleHas, validateCustomRole } from "@/src/lib/permissions";

describe("UT-54 permission matrix and custom roles - Module 11 FE-3, FE-4", () => {
  it("UT-54.01 built-in roles get the permissions of their level and above", () => {
    expect(roleHas("AGENT", "tickets.handle")).toBe(true);
    expect(roleHas("AGENT", "data.export")).toBe(false);
    expect(roleHas("MANAGER", "data.export")).toBe(true);
    expect(roleHas("MANAGER", "audit.view")).toBe(false);
    expect(roleHas("ADMIN", "audit.view")).toBe(true);
  });

  it("UT-54.02 a custom role adds and removes permissions on top of its base role", () => {
    const seniorAgent = { role: "AGENT", customRole: { permissions: ["data.export", "escalations.assign"], deniedPermissions: [] } };
    const limitedManager = { role: "MANAGER", customRole: { permissions: [], deniedPermissions: ["knowledge.manage"] } };
    expect(can(seniorAgent, "data.export")).toBe(true);
    expect(can(seniorAgent, "escalations.assign")).toBe(true);
    expect(can(seniorAgent, "audit.view")).toBe(false);
    expect(can(limitedManager, "knowledge.manage")).toBe(false);
    expect(can(limitedManager, "data.export")).toBe(true);
  });

  it("UT-54.03 the owner keeps every permission so a workspace cannot lock itself out", () => {
    const owner = { role: "OWNER", customRole: { permissions: [], deniedPermissions: ["roles.manage", "audit.view"] } };
    expect(effectivePermissions(owner)).toHaveLength(9);
  });

  it("UT-54.04 validates custom roles", () => {
    expect(validateCustomRole({ baseRole: "AGENT", permissions: ["data.export"], deniedPermissions: [] })).toBeNull();
    expect(validateCustomRole({ baseRole: "OWNER", permissions: [], deniedPermissions: [] })).toMatch(/base role/);
    expect(validateCustomRole({ baseRole: "AGENT", permissions: ["make.coffee"], deniedPermissions: [] })).toMatch(/Unknown permission/);
    expect(validateCustomRole({ baseRole: "MANAGER", permissions: ["data.export"], deniedPermissions: ["data.export"] })).toMatch(/both/);
    expect(validateCustomRole({ baseRole: "MANAGER", permissions: ["roles.manage"], deniedPermissions: [] })).toMatch(/stays with admins/);
  });

  it("UT-54.05 cleans the custom-role form and refuses built-in names", async () => {
    const { parseCustomRoleInput } = await import("@/src/lib/custom-roles");
    expect(parseCustomRoleInput({ name: "  Senior   agent ", baseRole: "AGENT", permissions: ["data.export", "data.export"], deniedPermissions: [] })).toEqual({
      value: { name: "Senior agent", description: null, baseRole: "AGENT", permissions: ["data.export"], deniedPermissions: [] },
    });
    expect(parseCustomRoleInput({ name: "Admin", baseRole: "AGENT" })).toMatchObject({ error: expect.stringContaining("built-in") });
    expect(parseCustomRoleInput({ name: "X", baseRole: "AGENT" })).toHaveProperty("error");
  });
});

describe("UT-55 audit log helpers - Module 11 FE-5", () => {
  it("UT-55.01 secrets never reach the audit log", () => {
    expect(redactMetadata({ email: "a@b.co", password: "hunter2", nested: { apiKey: "ak_123", token: "x" }, list: [{ secret: "s" }] })).toEqual({
      email: "a@b.co",
      password: "[redacted]",
      nested: { apiKey: "[redacted]", token: "[redacted]" },
      list: [{ secret: "[redacted]" }],
    });
  });

  it("UT-55.02 long values are shortened and odd values made safe", () => {
    const long = redactMetadata({ note: "x".repeat(800) }) as { note: string };
    expect(long.note.length).toBeLessThanOrEqual(501);
    expect(redactMetadata(undefined)).toBeUndefined();
  });

  it("UT-55.03 lists only the fields that changed, hiding secret values", () => {
    expect(changedFields({ name: "Old", role: "AGENT", password: "a" }, { name: "New", role: "AGENT", password: "b", untouched: undefined })).toEqual({
      name: { from: "Old", to: "New" },
      password: { from: "[redacted]", to: "[redacted]" },
    });
  });

  it("UT-55.04 reads audit filters and ignores unknown values", () => {
    const filters = parseAuditFilters(new URLSearchParams("category=access&outcome=DENIED&q=%20role%20&from=2026-11-01&to=2026-11-15&page=3"));
    expect(filters).toMatchObject({ category: "access", outcome: "DENIED", query: "role", page: 3 });
    expect(filters.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-11-15T23:59:59.999Z");
    expect(parseAuditFilters(new URLSearchParams("category=hacking&outcome=MAYBE&from=yesterday"))).toMatchObject({ category: null, outcome: null, from: null, page: 1 });
  });
});

describe("UT-56 API keys and the public API description - Module 11 FE-2", async () => {
  const { API_SCOPE_KEYS, generateApiKey, hashApiKey, pageResult, parseApiKeyInput } = await import("@/src/lib/api-keys");
  const { OPENAPI_SPEC } = await import("@/src/lib/public-api-spec");

  it("UT-56.01 a new key is long and random; only its hash and a short prefix are kept", () => {
    const first = generateApiKey();
    const second = generateApiKey();
    expect(first.key).toMatch(/^ad_live_[\w-]{40}$/);
    expect(first.key).not.toBe(second.key);
    expect(first.prefix).toBe(first.key.slice(0, 14));
    expect(first.keyHash).toBe(hashApiKey(first.key));
    expect(first.keyHash).not.toContain(first.key.slice(8));
  });

  it("UT-56.02 checks the name, permissions and expiry of a new key", () => {
    expect(parseApiKeyInput({ name: "  HubSpot   sync ", scopes: ["tickets:read", "tickets:read"], expiresInDays: 30 })).toMatchObject({ value: { name: "HubSpot sync", scopes: ["tickets:read"] } });
    expect(parseApiKeyInput({ name: "x", scopes: ["tickets:read"] })).toHaveProperty("error");
    expect(parseApiKeyInput({ name: "Store", scopes: [] })).toHaveProperty("error");
    expect(parseApiKeyInput({ name: "Store", scopes: ["admin:everything"] })).toMatchObject({ error: expect.stringContaining("Unknown permission") });
    expect(parseApiKeyInput({ name: "Store", scopes: ["leads:read"], expiresInDays: 5000 })).toMatchObject({ error: expect.stringContaining("730") });
    expect(parseApiKeyInput({ name: "Store", scopes: ["leads:read"] })).toMatchObject({ value: { expiresAt: null } });
  });

  it("UT-56.03 pages lists with a cursor", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(pageResult(rows, 2)).toEqual({ data: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
    expect(pageResult(rows, 5)).toEqual({ data: rows, nextCursor: null });
  });

  it("UT-56.04 the OpenAPI description lists every endpoint and scope", () => {
    expect(Object.keys(OPENAPI_SPEC.paths)).toEqual(["/", "/tickets", "/tickets/{id}", "/contacts", "/leads", "/conversations", "/conversations/{id}", "/escalations"]);
    for (const scope of API_SCOPE_KEYS) {
      expect(OPENAPI_SPEC.components.securitySchemes.apiKey.description).toContain(scope);
    }
  });
});

describe("UT-57 connector rules - Module 11 FE-1", async () => {
  const { hubspotProperties, normalizeShopDomain, orderBelongsTo, summarizeOrder } = await import("@/src/lib/connectors");

  it("UT-57.01 accepts only Shopify store addresses", () => {
    expect(normalizeShopDomain("kettle-store")).toBe("kettle-store.myshopify.com");
    expect(normalizeShopDomain("https://Kettle-Store.myshopify.com/admin/orders")).toBe("kettle-store.myshopify.com");
    for (const bad of ["evil.com", "kettle.myshopify.com.evil.com", "127.0.0.1", "", "-bad.myshopify.com", 42]) {
      expect(normalizeShopDomain(bad), String(bad)).toBeNull();
    }
  });

  it("UT-57.02 an order belongs to the customer only when their email or phone matches", () => {
    const order = { email: "Ali.Raza@example.com", phone: "+92 300 1112233", customer: null };
    expect(orderBelongsTo(order, { email: "ali.raza@example.com", phone: null })).toBe(true);
    expect(orderBelongsTo(order, { email: null, phone: "03001112233" })).toBe(true);
    expect(orderBelongsTo(order, { email: "someone@example.com", phone: null })).toBe(false);
    expect(orderBelongsTo(order, { email: null, phone: "123" })).toBe(false);
    expect(orderBelongsTo(order, { email: null, phone: null })).toBe(false);
  });

  it("UT-57.03 summarises an order without the address", () => {
    const summary = summarizeOrder({
      name: "#7",
      email: "a@b.co",
      phone: null,
      created_at: "2026-11-01T10:00:00Z",
      cancelled_at: null,
      financial_status: "paid",
      fulfillment_status: null,
      total_price: "10.00",
      currency: "USD",
      line_items: [{ title: "Mug", quantity: 2 }],
      fulfillments: [],
    });
    expect(summary).toEqual({ order: "#7", placedOn: "2026-11-01", status: "not shipped yet", payment: "paid", total: "10.00 USD", items: ["2 × Mug"], tracking: [] });
  });

  it("UT-57.04 maps a lead to HubSpot contact properties", () => {
    expect(hubspotProperties({ name: "Muhammad Ali Khan", email: "m@x.co", phone: null, company: null, status: "CONTACTED" })).toEqual({
      email: "m@x.co",
      firstname: "Muhammad",
      lastname: "Ali Khan",
      hs_lead_status: "ATTEMPTED_TO_CONTACT",
    });
    expect(hubspotProperties({ name: null, email: null, phone: "+92300", company: "X", status: "CONVERTED" })).toEqual({ phone: "+92300", company: "X" });
  });
});
