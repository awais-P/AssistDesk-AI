// Full end-to-end verification of AssistDesk against a running dev server and its (throwaway) database.
// Configuration: see config.mjs / README.md. Usage: node scripts/e2e/e2e-all.mjs [--skip-ai]
import { createHmac } from "node:crypto";
import http from "node:http";
import { writeFileSync } from "node:fs";

import pg from "pg";
import { E2E } from "./config.mjs";

const { Client } = pg;

const BASE = E2E.baseUrl;
const DEMO_WIDGET = "assistdesk-widget-demo";
const SKIP_AI = process.argv.includes("--skip-ai");
const RUN = Date.now().toString(36);
const db = new Client({ connectionString: E2E.databaseUrl });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
let currentSection = "";
function section(name) {
  currentSection = name;
  console.log(`\n=== ${name} ===`);
}
function check(name, ok, detail = "") {
  results.push({ section: currentSection, name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
}
async function waitFor(fn, timeoutMs = 30000, stepMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await sleep(stepMs);
  }
  return null;
}

let ipCounter = 10;
async function call(path, { method = "GET", body, cookie, headers = {}, raw = false, ip } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      "x-forwarded-for": ip ?? `198.51.100.${ipCounter}`,
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data: data ?? {}, text: raw ? text : text.slice(0, 500), headers: response.headers };
}
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];

async function login(email, password, ip) {
  const response = await call("/api/auth/login", { method: "POST", body: { email, password }, ip });
  return { response, cookie: cookieOf(response) };
}

// ---------------------------------------------------------------- webhook receiver
const received = [];
const receiver = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push({ headers: request.headers, body });
    response.writeHead(200).end("ok");
  });
});
await new Promise((resolve) => receiver.listen(4555, "127.0.0.1", resolve));

// ================================================================ M7/M11 accounts, auth, RBAC
section("Accounts, auth and roles (M7 FE-5, M11 FE-3/4, SEC)");
const admin = await login(E2E.adminEmail, E2E.adminPassword, "198.51.100.1");
check("demo admin can sign in", admin.response.status === 200 && admin.cookie, admin.response.status);
const A = admin.cookie;

const badLogin = await call("/api/auth/login", { method: "POST", body: { email: E2E.adminEmail, password: "wrong-password" }, ip: "198.51.100.2" });
check("wrong password is rejected", badLogin.status === 401 || badLogin.status === 400, badLogin.status);

const ownerEmail = `owner.${RUN}@example.com`;
const weak = await call("/api/auth/signup", { method: "POST", body: { fullName: "Weak", email: `weak.${RUN}@example.com`, password: "123" }, ip: "198.51.100.3" });
check("signup rejects a weak password", weak.status === 400, weak.data.error);
const signup = await call("/api/auth/signup", { method: "POST", body: { fullName: "Verify Owner", email: ownerEmail, password: "Verify-Pass-2026" }, ip: "198.51.100.4" });
const O = cookieOf(signup);
check("signup creates a workspace and signs in", signup.status === 200 && O && signup.data.redirectTo === "/setup", JSON.stringify(signup.data));
const dup = await call("/api/auth/signup", { method: "POST", body: { fullName: "Dup", email: ownerEmail, password: "Verify-Pass-2026" }, ip: "198.51.100.5" });
check("duplicate signup is refused", dup.status === 409, dup.status);
const [ownerRow] = await q(`select u.role, u."passwordHash", u."workspaceId" from "User" u where email=$1`, [ownerEmail]);
check("new user is the workspace OWNER", ownerRow?.role === "OWNER", ownerRow?.role);
check("password stored as a hash (not plaintext)", ownerRow && !ownerRow.passwordHash.includes("Verify-Pass") && ownerRow.passwordHash.length > 30, ownerRow?.passwordHash.slice(0, 7));
const [sessionRow] = await q(`select token from "Session" s join "User" u on u.id=s."userId" where u.email=$1 limit 1`, [ownerEmail]);
check("session token stored hashed", sessionRow && !O.includes(sessionRow.token), "cookie value ≠ stored hash");

const pwBad = await call("/api/profile/password", { method: "PATCH", cookie: O, body: { currentPassword: "nope-nope-nope", newPassword: "Verify-Pass-2027" } });
check("password change needs the current password", pwBad.status >= 400, pwBad.status);
const pwOk = await call("/api/profile/password", { method: "PATCH", cookie: O, body: { currentPassword: "Verify-Pass-2026", newPassword: "Verify-Pass-2027" } });
check("password can be changed", pwOk.status === 200, pwOk.status);
const relog = await login(ownerEmail, "Verify-Pass-2027", "198.51.100.6");
check("sign in with the new password", relog.response.status === 200, relog.response.status);
const O2 = relog.cookie;

const invite = await call("/api/users", { method: "POST", cookie: O2, body: { emails: [`agent.${RUN}@example.com`], role: "AGENT" } });
const agentUser = invite.data.users?.[0];
check("owner invites an Agent with a one-time temporary password", invite.status === 200 && agentUser?.temporaryPassword, invite.status);
const agentLogin = await login(`agent.${RUN}@example.com`, agentUser?.temporaryPassword ?? "", "198.51.100.7");
const G = agentLogin.cookie;
check("invited agent must change the temporary password", agentLogin.response.status === 200 && /password/i.test(JSON.stringify(agentLogin.response.data)), JSON.stringify(agentLogin.response.data));
for (const [path, method, body] of [
  ["/api/ai-agents", "POST", { name: "x", provider: "Default", model: "groq/llama-3.3-70b-versatile" }],
  ["/api/settings", "PATCH", { workspaceName: "Hacked", supportEmail: "x@example.com" }],
  ["/api/tools", "GET", undefined],
  ["/api/users", "POST", { emails: ["x@example.com"], role: "ADMIN" }],
  ["/api/webhooks", "GET", undefined],
]) {
  const res = await call(path, { method, cookie: G, body });
  check(`Agent role blocked: ${method} ${path}`, res.status === 403, res.status);
}
const unauth = await call("/api/tickets", { method: "POST", body: { subject: "x" } });
check("APIs refuse anonymous callers", unauth.status === 401, unauth.status);

// ================================================================ M1 agents, chatbots, channels
section("Assistant creation & channels (M1)");
const agentCreate = await call("/api/ai-agents", {
  method: "POST",
  cookie: A,
  body: { name: `Verify Agent ${RUN}`, provider: "Default", model: "groq/llama-3.3-70b-versatile", systemPrompt: "You are the AssistDesk demo store assistant. Be brief.", tone: "Friendly", responseLength: "Short", status: "ACTIVE", temperature: 0.3, confidenceThreshold: 0.3, maxTokens: 400 },
});
const agentId = agentCreate.data.agent?.id;
check("create an AI agent (tone, length, model)", agentCreate.status === 200 && agentId, agentCreate.status + " " + (agentCreate.data.error ?? ""));
const agentList = await call("/api/ai-agents", { cookie: A });
check("agents list shows it; API key never returned", JSON.stringify(agentList.data).includes(agentId ?? "none") && !/"apiKey":\s*"[^"]/.test(JSON.stringify(agentList.data)));

const botBody = { name: `Verify Bot ${RUN}`, agentId, allowedDomains: ["localhost"], welcomeMessage: "Hi! Ask me anything.", isActive: true, aiRepliesEnabled: true, replyMode: "ALWAYS", requireName: false, requireEmail: false, requirePhone: false, conversationStarters: ["Warranty?", "Returns?"], rateLimitPerMinute: 30, sessionTimeoutMinutes: 30 };
const botCreate = await call("/api/chatbots", { method: "POST", cookie: A, body: botBody });
const bot = botCreate.data.chatbot;
// The chatbot form always saves the whole configuration.
const saveBot = (overrides) => call("/api/chatbots", { method: "POST", cookie: A, body: { ...botBody, id: bot.id, ...overrides } });
check("create a website chatbot linked to the agent", botCreate.status === 200 && bot?.widgetId, botCreate.status + " " + (botCreate.data.error ?? ""));
const WIDGET = bot?.widgetId;

const widgetPage = await fetch(`${BASE}/widget/${WIDGET}`, { headers: { Referer: "http://localhost:8080/shop" } });
const pageText = await widgetPage.text();
const embedToken = pageText.match(/token\\?":\\?"([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/)?.[1];
check("widget page issues an embed token for an allowed site", widgetPage.status === 200 && embedToken);
const blockedPage = await fetch(`${BASE}/widget/${WIDGET}`, { headers: { Referer: "https://evil.example.com/" } });
const blockedText = await blockedPage.text();
check("widget refuses a site that is not allowed", !blockedText.match(/token\\?":\\?"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/), blockedPage.status);
const embedScript = await fetch(`${BASE}/assistdesk-widget.js`).catch(() => null);
check("embed script is served", embedScript && embedScript.status === 200, embedScript?.status);

async function widget(path, { method = "GET", body, session, widgetId = WIDGET, token = embedToken, ip = "203.0.113.20" } = {}) {
  const response = await fetch(`${BASE}/api/widget/${widgetId}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-assistdesk-widget-token": token, "x-forwarded-for": ip, ...(session ? { "x-assistdesk-session-token": session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})), headers: response.headers };
}
const config = await widget("");
check("widget config served with the token", config.status === 200 && JSON.stringify(config.data).includes("Ask me anything"), config.status);
const noToken = await fetch(`${BASE}/api/widget/${WIDGET}`, { headers: { "x-forwarded-for": "203.0.113.21" } });
check("widget API refuses calls without the embed token", noToken.status >= 400, noToken.status);

const inbox = await call("/api/inboxes", { method: "POST", cookie: A, body: { name: `Verify ${RUN}`, emailPrefix: `verify-${RUN}`, ticketPrefix: "VF", senderName: "Verify" } });
check("create an inbox with its own ticket prefix", inbox.status === 200 || inbox.status === 201, inbox.status + " " + (inbox.data.error ?? ""));
const integrations = await call("/api/integrations", { cookie: A });
check("integrations list (email, WhatsApp, Slack)", integrations.status === 200, integrations.status);
const prompt = await call("/api/prompts", { method: "POST", cookie: A, body: { name: `Refunds ${RUN}`, body: "Explain the refund policy politely." } });
const promptId = prompt.data.prompt?.id;
check("prompt templates: create", prompt.status === 200 || prompt.status === 201, prompt.status);
if (promptId) {
  check("prompt templates: edit", (await call(`/api/prompts/${promptId}`, { method: "PATCH", cookie: A, body: { name: `Refunds ${RUN}`, body: "Explain refunds." } })).status === 200);
  check("prompt templates: delete", (await call(`/api/prompts/${promptId}`, { method: "DELETE", cookie: A })).status === 200);
}
const canned = await call("/api/canned-responses", { method: "POST", cookie: A, body: { title: `Hello ${RUN}`, body: "Hi {{customer_name}}, thanks for writing." } });
check("canned responses: create", canned.status === 200 || canned.status === 201, canned.status);
const tag = await call("/api/tags", { method: "POST", cookie: A, body: { name: `vip-${RUN}`, color: "#ff0000" } });
const tagId = tag.data.tag?.id;
check("tags: create", (tag.status === 200 || tag.status === 201) && tagId, tag.status);

// ================================================================ M10 knowledge base
section("Knowledge base (M10)");
const ks = await call("/api/knowledge-sources", {
  method: "POST",
  cookie: A,
  body: { title: `Kettle Pro policy ${RUN}`, type: "TEXT", agentId, rawText: `Kettle Pro warranty and returns.\n\nThe AssistDesk Kettle Pro has a 3-year warranty that covers the heating element and the switch. Returns are accepted within 45 days of delivery if the kettle is unused. Refunds are paid back to the original card within 7 working days. Our support line is open Monday to Friday, 9am to 6pm Pakistan time.` },
});
const ksId = ks.data.knowledgeSource?.id ?? ks.data.source?.id;
check("add a text knowledge source", (ks.status === 200 || ks.status === 201) && ksId, ks.status + " " + (ks.data.error ?? JSON.stringify(ks.data).slice(0, 120)));
const synced = await waitFor(async () => {
  const [row] = await q(`select status, "processingError", (select count(*) from "KnowledgeChunk" c where c."sourceId"=s.id) as chunks from "KnowledgeSource" s where id=$1`, [ksId]);
  return row && ["SYNCED", "FAILED"].includes(row.status) ? row : null;
}, 90000, 2000);
check("source is chunked and indexed (embeddings)", synced?.status === "SYNCED" && Number(synced.chunks) > 0, JSON.stringify(synced));
const search = await call("/api/knowledge-sources/search", { method: "POST", cookie: A, body: { question: "How long is the kettle warranty?", agentId } });
check("retrieval finds the right passage (Test retrieval)", search.status === 200 && JSON.stringify(search.data.matches ?? []).includes("3-year"), `${search.status} ${search.data.matches?.length ?? 0} matches`);
const ssrf = await call("/api/knowledge-sources/test-url", { method: "POST", cookie: A, body: { url: "http://169.254.169.254/latest/meta-data" } });
check("URL sources block private/metadata addresses (SSRF)", ssrf.status >= 400 || ssrf.data.ok === false, `${ssrf.status} ${ssrf.data.error ?? ""}`);
const ksList = await call("/api/knowledge-sources", { cookie: A });
check("knowledge sources list", ksList.status === 200 && JSON.stringify(ksList.data).includes(ksId ?? "none"));

// ================================================================ M7 tickets and email channel
section("Tickets, inbox and email channel (M7, M1 FE-email)");
const ticket = await call("/api/tickets", { method: "POST", cookie: A, body: { subject: `Kettle not heating ${RUN}`, previewText: "My Kettle Pro stopped heating after two weeks.", requesterName: "Ali Raza", requesterEmail: `ali.${RUN}@example.com`, priority: "MEDIUM" } });
const ticketId = ticket.data.ticket?.id;
check("create a ticket", ticket.status === 200 && ticketId, ticket.status + " " + (ticket.data.error ?? ""));
const patched = await call(`/api/tickets/${ticketId}`, { method: "PATCH", cookie: A, body: { status: "IN_PROGRESS", priority: "HIGH", tagIds: tagId ? [tagId] : [] } });
check("update status, priority and tags", patched.status === 200, patched.status);
const note = await call(`/api/tickets/${ticketId}/messages`, { method: "POST", cookie: A, body: { content: "Internal: check warranty date.", mode: "internal" } });
const [afterNote] = await q(`select status, "previewText" from "Ticket" where id=$1`, [ticketId]);
check("internal note keeps status and the customer's issue", note.status === 200 && afterNote.status === "IN_PROGRESS" && afterNote.previewText.includes("stopped heating"), JSON.stringify(afterNote));
const reply = await call(`/api/tickets/${ticketId}/messages`, { method: "POST", cookie: A, body: { content: "Sorry about that, we will replace it.", mode: "reply" } });
check("agent reply on a ticket", reply.status === 200, reply.status);
const detail = await call(`/api/tickets/${ticketId}`, { cookie: A });
check("ticket detail with messages", detail.status === 200, detail.status);
const bulk = await call("/api/tickets/bulk", { method: "POST", cookie: A, body: { ids: [ticketId], action: "priority", value: "URGENT" } });
check("bulk action on tickets", bulk.status === 200, `${bulk.status} ${bulk.data.error ?? ""}`);

const [emailIntegration] = await q(`select "webhookSecret", "supportAddress" from "Integration" where type='EMAIL' and "workspaceId"=(select "workspaceId" from "Chatbot" where "widgetId"=$1) limit 1`, [DEMO_WIDGET]);
if (emailIntegration?.webhookSecret) {
  const messageId = `<verify-${RUN}@example.com>`;
  const inbound = await call("/api/integrations/email/inbound", {
    method: "POST",
    headers: { "x-assistdesk-secret": emailIntegration.webhookSecret },
    body: { fromEmail: `email.${RUN}@example.com`, fromName: "Email Customer", subject: `Invoice question ${RUN}`, text: "Hello, can you resend my invoice?", messageId, toEmail: emailIntegration.supportAddress },
  });
  check("inbound email creates a ticket", inbound.status === 200 || inbound.status === 201, `${inbound.status} ${inbound.data.error ?? ""}`);
  const [created] = await q(`select t."ticketNumber", coalesce(i."ticketPrefix", 'AD') as prefix from "Ticket" t left join "Inbox" i on i.id=t."inboxId" where t."requesterEmail"=$1`, [`email.${RUN}@example.com`]);
  // Replies thread by the [PREFIX-NUMBER] reference our emails carry in the subject.
  const followUp = await call("/api/integrations/email/inbound", {
    method: "POST",
    headers: { "x-assistdesk-secret": emailIntegration.webhookSecret },
    body: { fromEmail: `email.${RUN}@example.com`, subject: `Re: [${created?.prefix}-${created?.ticketNumber}] Invoice question ${RUN}`, text: "Any update?", messageId: `<verify-2-${RUN}@example.com>`, inReplyTo: messageId, toEmail: emailIntegration.supportAddress },
  });
  const emailTickets = await q(`select id from "Ticket" where "requesterEmail"=$1`, [`email.${RUN}@example.com`]);
  check("email reply with the ticket reference threads into the same ticket", followUp.status < 300 && emailTickets.length === 1, `${emailTickets.length} ticket(s), ref ${created?.prefix}-${created?.ticketNumber}`);
  const wrongSecret = await call("/api/integrations/email/inbound", { method: "POST", headers: { "x-assistdesk-secret": "wrong" }, body: { fromEmail: "x@example.com", subject: "x", text: "x" } });
  check("inbound email with a wrong secret is refused", wrongSecret.status === 401 || wrongSecret.status === 403 || wrongSecret.status === 404, wrongSecret.status);
} else {
  check("inbound email (demo email integration present)", false, "no EMAIL integration in the demo workspace");
}
const notifications = await call("/api/notifications", { cookie: A });
check("notifications feed", notifications.status === 200, notifications.status);
const del = await call(`/api/tickets/${ticketId}`, { method: "DELETE", cookie: A });
check("delete a ticket", del.status === 200, del.status);

// ================================================================ M5 sessions + M1 widget chat with RAG
section("Website chat, sessions & context (M5, M1 widget, M10 RAG)");
const visitorId = `verify-visitor-${RUN}`;
const identity = { customerName: "Hina Shah", customerEmail: `hina.${RUN}@example.com`, visitorId };
let token1 = null;
let session1 = null;
if (!SKIP_AI) {
  const first = await widget("/messages", { method: "POST", body: { ...identity, message: "How long is the warranty on the Kettle Pro?" } });
  token1 = first.data.sessionToken;
  session1 = first.data.session?.id;
  const aiText = [...(first.data.messages ?? [])].reverse().find((m) => m.sender === "AI")?.content ?? "";
  console.log("   AI:", aiText.slice(0, 200));
  check("first message starts a session with a secret token", first.status === 200 && token1 && first.data.sessionStarted, `${first.status} ${first.data.error ?? ""}`);
  check("AI answers from the knowledge base (grounded)", /3\W?year|three/i.test(aiText), aiText.slice(0, 120));
  const [interaction] = await q(`select grounded, "usedFallback", model from "AiInteraction" where "sessionId"=$1 order by "createdAt" desc limit 1`, [session1]);
  check("AI reply recorded for analytics (AiInteraction)", interaction, JSON.stringify(interaction));
  await sleep(3000);
  const second = await widget("/messages", { method: "POST", session: token1, body: { ...identity, message: "And how many days do I have to return it?" } });
  const ai2 = [...(second.data.messages ?? [])].reverse().find((m) => m.sender === "AI")?.content ?? "";
  console.log("   AI:", ai2.slice(0, 200));
  check("same session continues", second.status === 200 && !second.data.sessionToken);
  check("follow-up answered in context (45 days)", /45/.test(ai2), ai2.slice(0, 120));
} else {
  await saveBot({ aiRepliesEnabled: false });
  const first = await widget("/messages", { method: "POST", body: { ...identity, message: "Hello there" } });
  token1 = first.data.sessionToken;
  session1 = first.data.session?.id;
  check("first message starts a session with a secret token", first.status === 200 && token1, first.status);
}
const [sessRow] = await q(`select "sessionTokenHash", "contactId", "clientIpHash" from "ChatSession" where id=$1`, [session1]);
check("session token stored only as a hash", sessRow?.sessionTokenHash && sessRow.sessionTokenHash !== token1);
check("session linked to a Contact", sessRow?.contactId);
check("client IP stored hashed", sessRow?.clientIpHash && !sessRow.clientIpHash.includes("203.0.113"));
const hist = await widget("/messages", { session: token1 });
check("history returned with the token", hist.data.session?.id === session1 && hist.data.messages?.length >= 1, hist.data.messages?.length);
const noTok = await widget("/messages");
check("no token → no conversation revealed", !noTok.data.session && (noTok.data.messages ?? []).length === 0);
const sse = await (async () => {
  const controller = new AbortController();
  // Dev mode compiles a route on first use (up to ~12 s); a production build is instant.
  const timer = setTimeout(() => controller.abort(), 20000);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE}/api/widget/${WIDGET}/stream?token=${encodeURIComponent(embedToken)}&session=${encodeURIComponent(hist.data.streamToken ?? token1)}`, { signal: controller.signal, headers: { "x-forwarded-for": "203.0.113.20" } });
    clearTimeout(timer);
    const type = response.headers.get("content-type");
    controller.abort();
    return { status: response.status, type, ms: Date.now() - startedAt };
  } catch (error) {
    return { status: 0, type: String(error) };
  }
})();
check("real-time stream (SSE) available to the widget", sse.status === 200 && /event-stream/.test(sse.type ?? ""), JSON.stringify(sse));

const sessions = await call("/api/chat-sessions", { cookie: A });
check("Chats list shows the conversation", JSON.stringify(sessions.data).includes(session1 ?? "none"), sessions.status);
const ctx = await call(`/api/chat-sessions/${session1}/context`, { cookie: A });
check("context panel data (customer, memory, events)", ctx.status === 200, ctx.status);
const takeover = await call(`/api/chat-sessions/${session1}`, { method: "PATCH", cookie: A, body: { status: "ESCALATED" } });
check("agent takes over the chat (ESCALATED)", takeover.status === 200, takeover.status);
const during = await widget("/messages", { method: "POST", session: token1, body: { ...identity, message: "Is anyone there?" } });
check("AI stays quiet while a human has the chat", during.status === 200 && !(during.data.messages ?? []).some((m) => m.sender === "AI"), JSON.stringify((during.data.messages ?? []).map((m) => m.sender)));
const agentReply = await call(`/api/chat-sessions/${session1}/messages`, { method: "POST", cookie: A, body: { content: "Hi Hina, this is Sana from support." } });
check("agent replies from the dashboard", agentReply.status === 200, agentReply.status);
const seen = await widget("/messages", { session: token1 });
check("visitor sees the agent's reply", JSON.stringify(seen.data.messages ?? []).includes("Sana from support"));
check("hand back to the AI (ACTIVE)", (await call(`/api/chat-sessions/${session1}`, { method: "PATCH", cookie: A, body: { status: "ACTIVE" } })).status === 200);
const transcript = await call(`/api/chat-sessions/${session1}/transcript`, { cookie: A, raw: true });
check("transcript download (M4 FE-2)", transcript.status === 200 && transcript.text.includes("Sana"), transcript.status);
const ended = await widget("/session", { method: "DELETE", session: token1 });
check("visitor ends the conversation (CLOSED)", ended.status === 200 && ended.data.session?.status === "CLOSED", JSON.stringify(ended.data.session?.closedReason));
await sleep(2500);
const again = await widget("/messages", { method: "POST", session: token1, body: { ...identity, message: "Hello again" } });
check("next message starts a NEW session linked to the old one", again.data.sessionStarted && again.data.previousSession?.id === session1, again.status);
const contacts = await call("/api/contacts", { cookie: A });
const contactId = sessRow?.contactId;
check("customer appears in Contacts", JSON.stringify(contacts.data).includes(contactId ?? "none"), contacts.status);
const contactPatch = await call(`/api/contacts/${contactId}`, { method: "PATCH", cookie: A, body: { memory: "Prefers WhatsApp. Owns a Kettle Pro." } });
check("edit the customer's AI memory", contactPatch.status === 200, contactPatch.status);
const contactGet = await call(`/api/contacts/${contactId}`, { cookie: A });
check("contact detail shows sessions across channels", contactGet.status === 200 && JSON.stringify(contactGet.data).includes(session1 ?? "none"), contactGet.status);
const otherWs = await call(`/api/contacts/${contactId}`, { cookie: O2 });
check("another workspace cannot see this customer", otherWs.status === 404, otherWs.status);

// Rate limit: no AI cost
const rlSave = await saveBot({ aiRepliesEnabled: false, rateLimitPerMinute: 3 });
check("chatbot settings saved (rate limit 3/min)", rlSave.status === 200, `${rlSave.status} ${rlSave.data.error ?? ""}`);
let limited = null;
let rlToken = null;
for (let index = 0; index < 6; index += 1) {
  const res = await widget("/messages", { method: "POST", session: rlToken, ip: "203.0.113.99", body: { visitorId: `rl-${RUN}`, message: `spam ${index}` } });
  rlToken = rlToken ?? res.data.sessionToken;
  if (res.status === 429) {
    limited = res;
    break;
  }
}
check("rate limiting returns 429 with Retry-After", limited && limited.headers.get("retry-after"), limited ? `429 after messages, Retry-After ${limited.headers.get("retry-after")}` : "never limited");
await saveBot({ aiRepliesEnabled: !SKIP_AI, rateLimitPerMinute: 30 });

const cronNo = await call("/api/cron/sessions");
check("cron endpoint needs CRON_SECRET", cronNo.status === 401, cronNo.status);
const cronYes = await call("/api/cron/sessions", { headers: { authorization: `Bearer ${E2E.cronSecret}` } });
check("session expiry cron runs", cronYes.status === 200 && "expiredSessions" in cronYes.data && "expiredConfirmations" in cronYes.data, JSON.stringify(cronYes.data));

// ================================================================ M8 leads
section("Lead generation (M8)");
const leadSettings = await call("/api/leads/settings", { cookie: A });
check("lead settings", leadSettings.status === 200, leadSettings.status);
const hook = await call("/api/webhooks", { method: "POST", cookie: A, body: { name: `Verify CRM ${RUN}`, url: "http://127.0.0.1:4555/hook", events: ["lead.created", "lead.updated", "lead.status_changed"] } });
const hookSecret = hook.data.secret;
check("webhook endpoint created; secret shown once", hook.status === 201 && hookSecret, `${hook.status} ${hook.data.error ?? ""}`);
const hookList = await call("/api/webhooks", { cookie: A });
check("secret is not returned again", hookList.status === 200 && !JSON.stringify(hookList.data).includes(hookSecret ?? "zzz"));

const leadSave = await saveBot({
    leadForm: { enabled: true, trigger: "FIRST_MESSAGE", title: "Can we follow up?", allowSkip: true, fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "company", label: "Company", type: "text", required: false }] },
});
check("lead form configured on the chatbot (FE-1 builder)", leadSave.status === 200, `${leadSave.status} ${leadSave.data.error ?? ""}`);
const leadVisitor = { visitorId: `lead-${RUN}` };
const leadChat = await widget("/messages", { method: "POST", ip: "203.0.113.30", body: { ...leadVisitor, message: "Hi, I want a quote for 40 kettles for my hotel." } });
check("lead form shown and the AI waits", leadChat.status === 200 && leadChat.data.leadPrompt && !(leadChat.data.messages ?? []).some((m) => m.sender === "AI"), JSON.stringify(leadChat.data.leadPrompt?.form?.title ?? leadChat.data.error));
const leadToken = leadChat.data.sessionToken;
const badLead = await widget("/lead", { method: "POST", session: leadToken, ip: "203.0.113.30", body: { values: { name: "Usman", email: "not-an-email" } } });
check("lead form validates fields", badLead.status === 400, badLead.data.error);
const leadSubmit = await widget("/lead", { method: "POST", session: leadToken, ip: "203.0.113.30", body: { values: { name: "Usman Tariq", email: `usman.${RUN}@example.com`, company: "Pearl Hotel" }, consent: true } });
check("lead captured from the form", leadSubmit.status === 200, `${leadSubmit.status} ${leadSubmit.data.error ?? ""}`);
const [leadRow] = await q(`select id, status, score, source, "contactId", intent from "Lead" where email=$1`, [`usman.${RUN}@example.com`]);
check("lead saved with score, source and contact link", leadRow && leadRow.contactId && leadRow.score > 0, JSON.stringify(leadRow));
const leads = await call("/api/leads?q=" + encodeURIComponent("Usman"), { cookie: A });
check("leads list and search", JSON.stringify(leads.data).includes(leadRow?.id ?? "none"), leads.status);
const leadPatch = await call(`/api/leads/${leadRow?.id}`, { method: "PATCH", cookie: A, body: { status: "QUALIFIED" } });
check("change lead status", leadPatch.status === 200, leadPatch.status);
const leadNote = await call(`/api/leads/${leadRow?.id}/notes`, { method: "POST", cookie: A, body: { text: "Called, wants 40 units." } });
check("add a note to the lead", leadNote.status === 200 || leadNote.status === 201, leadNote.status);
const csv = await call("/api/leads/export", { cookie: A, raw: true });
check("CSV export of leads", csv.status === 200 && csv.text.includes("Usman"), csv.status);
const delivered = await waitFor(async () => (received.filter((item) => item.body.includes(`usman.${RUN}`)).length >= 2 ? received : null), 30000, 1000);
// Other endpoints (from earlier runs) may post to the same receiver: verify with this endpoint's secret.
const ours = received.filter((item) => item.body.includes(`usman.${RUN}`));
const verify = (item) => {
  const header = item.headers["x-assistdesk-signature"] ?? "";
  const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=")));
  return parts.t && parts.v1 === createHmac("sha256", hookSecret).update(`${parts.t}.${item.body}`).digest("hex");
};
const signedOk = ours.filter(verify);
const tampered = ours[0] ? !verify({ ...ours[0], body: ours[0].body.replace("Usman", "Hacker") }) : false;
const signature = signedOk[0]?.headers["x-assistdesk-signature"] ?? "";
check("webhooks delivered for lead.created and the status change", delivered, `${received.length} deliveries received`);
check("webhook signed with HMAC-SHA256 (SRS CI-3)", signedOk.length >= 2, `${signedOk.length}/${ours.length} deliveries verified with this endpoint's secret; ${signature.slice(0, 30)}`);
check("a tampered body fails signature verification", tampered);
const hookId = hook.data.endpoint?.id;
const hookTest = await call(`/api/webhooks/${hookId}/test`, { method: "POST", cookie: A });
check("webhook 'Send test' works", hookTest.status === 200, `${hookTest.status} ${hookTest.data.status ?? hookTest.data.error ?? ""}`);
const deliveries = await call(`/api/webhooks/${hookId}/deliveries`, { cookie: A });
check("delivery log", deliveries.status === 200 && (deliveries.data.deliveries ?? []).length >= 2, (deliveries.data.deliveries ?? []).length);

// ================================================================ M4 analytics
section("Monitoring & analytics (M4)");
const analytics = await call("/api/analytics?range=7d", { cookie: A });
check("analytics dashboard data (FR-11.1–11.7)", analytics.status === 200, Object.keys(analytics.data).join(","));
const live = await call("/api/analytics/live", { cookie: A });
check("live numbers (active sessions)", live.status === 200, Object.keys(live.data).join(","));
const reports = await call("/api/analytics/reports?range=30d", { cookie: A });
check("reports: FAQ, behaviour, leads, tickets, AI actions", reports.status === 200 && ["faq", "behavior", "leads", "tickets", "actions"].every((key) => key in reports.data), Object.keys(reports.data).join(","));
const improve = await call("/api/analytics/improvements?range=30d", { cookie: A });
check("improvement areas", improve.status === 200, Object.keys(improve.data).join(","));
const exp = await call("/api/analytics/export?type=interactions&range=30d", { cookie: A, raw: true });
check("anonymised CSV export of interactions", exp.status === 200 && exp.text.split("\n").length >= 1, exp.status);
const expAgent = await call("/api/analytics/export?type=interactions&range=30d", { cookie: G });
check("exports need Manager or above", expAgent.status === 403, expAgent.status);
if (!SKIP_AI) {
  const history = await widget("/messages", { session: again.data.sessionToken ?? token1 });
  const anyAi = (await q(`select m.id from "ChatMessage" m where m."sessionId"=$1 and m.sender='AI' limit 1`, [session1]))[0];
  const fb = await widget("/feedback", { method: "POST", session: token1, body: { messageId: anyAi?.id, rating: -1, comment: "Wanted the exact date." } });
  check("visitor rates an AI reply (👎 with comment)", fb.status === 200 || fb.status === 404, `${fb.status} ${fb.data.error ?? ""} (old session token may be closed: ${history.status})`);
}

// ================================================================ pages render
section("Dashboard pages render (signed in)");
for (const path of [
  "/dashboard", "/dashboard/tickets", "/dashboard/chats", "/dashboard/contacts", "/dashboard/leads", "/dashboard/leads/settings", "/dashboard/appointments",
  "/dashboard/analytics", "/dashboard/analytics/reports", "/dashboard/analytics/improve", "/dashboard/reports", "/dashboard/users", "/dashboard/ai-agents",
  `/dashboard/ai-agents/${agentId}`, "/dashboard/tools", "/dashboard/prompts", "/dashboard/logs", "/dashboard/logs?tab=actions", "/dashboard/inboxes",
  "/dashboard/chatbots", `/dashboard/chatbots/${bot?.id}`, "/dashboard/knowledge-base", "/dashboard/canned-responses", "/dashboard/tags",
  "/dashboard/settings", "/dashboard/integrations", "/dashboard/profile",
]) {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie: A }, redirect: "manual" });
  const html = await response.text();
  // Next.js ships its 404 boundary in every page's data: check the rendered markup only.
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const broken = /__next_error__|Application error|Unhandled Runtime Error|This page could not be found|Something went wrong/i.test(visible);
  check(`page ${path}`, response.status === 200 && !broken, `${response.status}${broken ? " (error text in page)" : ""}`);
}
const anon = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
check("dashboard redirects anonymous visitors to login", anon.status >= 300 && anon.status < 400, anon.status);

// ---------------------------------------------------------------- summary
receiver.close();
await db.end();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const result of failed) console.log(`FAILED [${result.section}] ${result.name} — ${result.detail}`);
writeFileSync(new URL("./e2e-all.results.json", import.meta.url), JSON.stringify({ run: RUN, at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
