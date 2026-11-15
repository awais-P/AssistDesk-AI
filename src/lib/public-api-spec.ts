import { API_RATE_LIMIT, API_SCOPES } from "./api-keys";

/** Module 11 FE-2: OpenAPI 3.1 description of /api/v1, served at /api/v1/openapi.json. */

const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "nextCursor from the previous page" },
];

const listResponse = (description: string) => ({
  "200": { description, content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { type: "object" } }, nextCursor: { type: ["string", "null"] } } } } } },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/MissingScope" },
  "429": { $ref: "#/components/responses/RateLimited" },
});

const errorSchema = { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } };

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "AssistDesk public API",
    version: "1.0.0",
    description: `Tickets, customers, leads, conversations and escalations of one workspace. Authenticate with an API key from AssistDesk → API Keys: \`Authorization: Bearer ad_live_…\`. Each key has scopes and a limit of ${API_RATE_LIMIT.limit} requests per minute. Writes are recorded in the workspace's audit log.`,
  },
  servers: [{ url: "/api/v1" }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `Scopes: ${API_SCOPES.map((scope) => scope.key).join(", ")}` } },
    schemas: { Error: errorSchema },
    responses: {
      Unauthorized: { description: "Missing, invalid, revoked or expired key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      MissingScope: { description: "The key lacks the scope this call needs", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      RateLimited: { description: "Too many requests for this key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
  },
  paths: {
    "/": { get: { summary: "The key's workspace and scopes", responses: { "200": { description: "Workspace and key" } } } },
    "/tickets": {
      get: { summary: "List tickets (tickets:read)", parameters: [...page, { name: "status", in: "query", schema: { enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] } }, { name: "requester_email", in: "query", schema: { type: "string" } }], responses: listResponse("Tickets, newest first") },
      post: {
        summary: "Create a ticket (tickets:write)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["subject", "message"], properties: { subject: { type: "string" }, message: { type: "string" }, requester_email: { type: "string" }, requester_name: { type: "string" }, priority: { enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] } } } } },
        },
        responses: { "201": { description: "The ticket, after the same automations as any new ticket" }, "400": { description: "Invalid input" } },
      },
    },
    "/tickets/{id}": { get: { summary: "A ticket with its messages (tickets:read)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Ticket" }, "404": { description: "Not in this workspace" } } } },
    "/contacts": {
      get: { summary: "List customers (contacts:read)", parameters: [...page, { name: "email", in: "query", schema: { type: "string" } }], responses: listResponse("Customers, most recently seen first") },
      post: { summary: "Create or update a customer by email or phone (contacts:write)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" }, phone: { type: "string" }, name: { type: "string" } } } } } }, responses: { "201": { description: "The customer" } } },
    },
    "/leads": {
      get: { summary: "List leads (leads:read)", parameters: [...page, { name: "status", in: "query", schema: { type: "string" } }], responses: listResponse("Leads, newest first") },
      post: { summary: "Create a lead (leads:write)", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" }, phone: { type: "string" }, name: { type: "string" }, company: { type: "string" }, interest: { type: "string" } } } } } }, responses: { "201": { description: "New lead" }, "200": { description: "The customer's open lead, updated" } } },
    },
    "/conversations": { get: { summary: "List conversations (conversations:read)", parameters: [...page, { name: "status", in: "query", schema: { enum: ["ACTIVE", "ESCALATED", "CLOSED"] } }, { name: "channel", in: "query", schema: { enum: ["WEB_WIDGET", "WHATSAPP", "SLACK", "EMAIL"] } }], responses: listResponse("Conversations, most recent activity first") } },
    "/conversations/{id}": { get: { summary: "A conversation with its transcript (conversations:read)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Conversation" }, "404": { description: "Not in this workspace" } } } },
    "/escalations": { get: { summary: "List escalations (escalations:read)", parameters: [{ name: "status", in: "query", schema: { enum: ["PENDING", "ACCEPTED", "RESOLVED"] } }, { name: "limit", in: "query", schema: { type: "integer" } }], responses: listResponse("Escalations") } },
  },
} as const;
