// Module 2 end-to-end check against a running dev server, with a REAL model. Run setup-m2.mjs first.
// Configuration: see config.mjs / README.md.

import pg from "pg";
import { E2E } from "./config.mjs";

const { Client } = pg;

const BASE = E2E.baseUrl;
const WIDGET = "assistdesk-widget-demo";
const db = new Client({ connectionString: E2E.databaseUrl });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------- dashboard login ----------
const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.20" },
  body: JSON.stringify({ email: E2E.adminEmail, password: E2E.adminPassword }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
check("dashboard login", login.ok);
const dash = async (path, init = {}) => {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), cookie, "Content-Type": "application/json" } });
  return { status: response.status, data: await response.json().catch(() => ({})) };
};

// ---------- the widget's agent has actions ----------
const [chatbot] = await q(`select id, "workspaceId", "agentId" from "Chatbot" where "widgetId"=$1`, [WIDGET]);
await q(`update "Chatbot" set "aiRepliesEnabled"=true where id=$1`, [chatbot.id]);
const agentTools = await dash(`/api/ai-agents/${chatbot.agentId}/tools`);
check("widget agent has actions switched on", agentTools.data.agent?.toolsEnabled, `${agentTools.data.tools?.filter((tool) => tool.bound).length} actions bound`);

const page = await (await fetch(`${BASE}/widget/${WIDGET}`, { headers: { Referer: "http://localhost:8080/shop" } })).text();
const embedToken = page.match(/token\\?":\\?"([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/)?.[1];
check("widget embed token", embedToken);

async function widget(path, { method = "GET", body, session } = {}) {
  const response = await fetch(`${BASE}/api/widget/${WIDGET}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-assistdesk-widget-token": embedToken,
      "x-forwarded-for": "203.0.113.42",
      ...(session ? { "x-assistdesk-session-token": session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

const identity = { customerName: "Sara Ahmed", customerEmail: `sara.m2.${Date.now()}@example.com`, visitorId: `e2e-m2-${Date.now()}` };
const lastAi = (data) => [...(data.messages ?? [])].reverse().find((message) => message.sender === "AI")?.content ?? "";

// ---------- FE-1 order tracking (custom HTTP tool) ----------
const first = await widget("/messages", { method: "POST", body: { ...identity, message: "Hi! Where is my order 1042?" } });
const token = first.data.sessionToken;
const sessionId = first.data.session?.id;
check("chat started", first.status === 200 && token, `${first.status} ${first.data.error ?? ""}`);
const reply1 = lastAi(first.data);
console.log("   AI:", reply1.slice(0, 220));
const [run1] = await q(`select id, status, source, "toolCalls", model, trace from "AgentRun" where "sessionId"=$1 order by "createdAt" asc limit 1`, [sessionId]);
check("reasoning run recorded for the chat", run1 && run1.source === "CHAT", `${run1?.status} via ${run1?.model}`);
const [track] = await q(`select status, "dryRun", "triggeredBy", reasoning, output from "ToolExecution" where "sessionId"=$1 and "toolKey"='track_order'`, [sessionId]);
check("track_order ran for real (forced by the intent rule)", track?.status === "SUCCESS" && track.dryRun === false, `${track?.status} — why: ${track?.reasoning}`);
check("reply uses the order facts", /deliver|courier|leopards|1042/i.test(reply1));
check("chain of thought stored", Array.isArray(run1?.trace) && run1.trace.some((entry) => entry.type === "intent"), JSON.stringify(run1?.trace?.map((entry) => entry.type)));

// ---------- FE-1/FE-2 booking with confirmation ----------
await sleep(4000);
// Booking hours are Mon–Fri: ask for the next weekday (Pakistan time).
let ahead = 1;
const weekdayOf = (offset) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", weekday: "short" }).format(new Date(Date.now() + offset * 86_400_000));
while (["Sat", "Sun"].includes(weekdayOf(ahead))) ahead += 1;
const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(Date.now() + ahead * 86_400_000));
const askBooking = await widget("/messages", {
  method: "POST",
  session: token,
  body: { ...identity, message: `Can you book me an appointment on ${tomorrow} at ${["11:00", "11:30", "14:00", "15:00"][Math.floor(Date.now() / 1000) % 4]} about a bulk order? My name is Sara Ahmed.` },
});
const reply2 = lastAi(askBooking.data);
console.log("   AI:", reply2.slice(0, 260));
const appointmentsBefore = Number((await q(`select count(*) from "Appointment" where "workspaceId"=$1 and status='BOOKED' and "sessionId"=$2`, [chatbot.workspaceId, sessionId]))[0].count);
const pending = await q(`select id, status from "ToolExecution" where "sessionId"=$1 and "toolKey"='book_appointment'`, [sessionId]);
check("nothing is booked before the customer says yes", appointmentsBefore === 0, `held by server: ${pending.some((row) => row.status === "PENDING_CONFIRMATION")}`);
check("AI asks to confirm instead of claiming it's done", /\?|confirm|go ahead|shall/i.test(reply2) && !/is booked|have booked|booked for you/i.test(reply2));

await sleep(4000);
const yes = await widget("/messages", { method: "POST", session: token, body: { ...identity, message: "Yes please, go ahead" } });
const reply3 = lastAi(yes.data);
console.log("   AI:", reply3.slice(0, 220));
const bookings = await q(`select status, "triggeredBy", reasoning from "ToolExecution" where "sessionId"=$1 and "toolKey"='book_appointment' order by "createdAt"`, [sessionId]);
check("'yes' runs the booking on the server", bookings.some((row) => row.status === "SUCCESS" && row.triggeredBy === "CONFIRMATION"), JSON.stringify(bookings.map((row) => [row.status, row.triggeredBy])));
const [appointment] = await q(`select name, email, "createdBy", "startsAt" from "Appointment" where "sessionId"=$1 and status='BOOKED'`, [sessionId]);
check("appointment created with the real (unmasked) email, linked to the chat", appointment?.createdBy === "AI" && appointment.email === identity.customerEmail, JSON.stringify(appointment));
check("customer is told it's booked (not asked again)", /booked|confirmed|scheduled|all set/i.test(reply3) && !/shall i go ahead/i.test(reply3));

// ---------- FE-5 action logs API ----------
const logs = await dash(`/api/action-logs?session=${sessionId}&sort=oldest`);
check("action logs list this chat's runs", logs.status === 200 && logs.data.total >= 3, `${logs.data.total} runs`);
const actions = await dash(`/api/action-logs?view=actions&session=${sessionId}`);
check("action logs list this chat's actions", actions.data.rows?.some((row) => row.toolKey === "book_appointment" && row.triggeredBy === "CONFIRMATION"));
const detail = await dash(`/api/action-logs/runs/${run1.id}`);
check("run detail returns trace + executions", detail.data.run?.executions?.some((row) => row.toolKey === "track_order"));

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`session: ${sessionId}`);
await db.end();
process.exit(failed.length ? 1 : 0);
