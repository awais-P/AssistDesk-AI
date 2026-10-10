// Prepares the demo widget's agent for e2e-m2.mjs on a fresh database (what an admin does in the UI):
// adds the "Track order" tool from its template, switches actions on and adds the order intent rule.

import pg from "pg";
import { E2E } from "./config.mjs";

const { Client } = pg;
const BASE = E2E.baseUrl;

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.30" },
  body: JSON.stringify({ email: E2E.adminEmail, password: E2E.adminPassword }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const json = async (path, init = {}) => {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { cookie, "Content-Type": "application/json" } });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

const db = new Client({ connectionString: E2E.databaseUrl });
await db.connect();
const [{ agentId }] = (await db.query(`select "agentId" from "Chatbot" where "widgetId"='assistdesk-widget-demo'`)).rows;
await db.end();

const tools = await json("/api/tools");
if (!tools.data.tools.some((tool) => tool.key === "track_order")) {
  const template = tools.data.templates.find((item) => item.id === "order_tracking").tool;
  const created = await json("/api/tools", { method: "POST", body: JSON.stringify({ ...template, agentIds: [agentId] }) });
  console.log("track_order tool:", created.status, created.data.error ?? "created");
}
const all = await json("/api/tools");
const saved = await json(`/api/ai-agents/${agentId}/tools`, {
  method: "PUT",
  body: JSON.stringify({
    toolsEnabled: true,
    toolIds: all.data.tools.map((tool) => tool.id),
    intentRules: [{ phrases: ["where is my order", "track my order"], toolKey: "track_order", mode: "ALWAYS" }],
  }),
});
console.log("agent actions:", saved.status, saved.data.agent?.toolsEnabled, `${saved.data.tools?.filter((tool) => tool.bound).length} bound`);
