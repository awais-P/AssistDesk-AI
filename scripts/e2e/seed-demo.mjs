// Fills the demo workspace with a realistic sample store (policies, FAQ, order-tracking tool,
// conversations, tickets, leads, appointments) for demos and the browser UI tests (tests/ui).
// Uses the real APIs (and the real AI for the chats). Throwaway databases only; see README.md.
import pg from "pg";
import { E2E } from "./config.mjs";

const BASE = E2E.baseUrl;
const db = new pg.Client({ connectionString: E2E.databaseUrl });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.40" },
  body: JSON.stringify({ email: E2E.adminEmail, password: E2E.adminPassword }),
});
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
// PGlite mixes up parallel queries now and then (OPS-10): retry reads that fail with a 500.
const api = async (path, method = "GET", body) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BASE}${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (response.status === 500 && method === "GET") {
      await sleep(800);
      continue;
    }
    if (!response.ok) console.log(`  ! ${method} ${path} → ${response.status} ${data.error ?? ""}`);
    return data;
  }
  console.log(`  ! ${method} ${path} kept failing`);
  return {};
};
console.log("login", login.status);

const [bot] = await q(`select * from "Chatbot" where "widgetId"='assistdesk-widget-demo'`);
const agentId = bot.agentId;

// Knowledge base
const sources = await api("/api/knowledge-sources");
if (!JSON.stringify(sources).includes("Store policies")) {
  await api("/api/knowledge-sources", "POST", {
    title: "Store policies: warranty, returns and delivery",
    type: "TEXT",
    agentId,
    rawText: [
      "Warranty: every AssistDesk Home kettle and toaster has a 3-year warranty that covers the heating element, the switch and the thermostat. Accidental damage is not covered.",
      "Returns: unused products can be returned within 45 days of delivery. Refunds go back to the original card within 7 working days.",
      "Delivery: orders inside Lahore, Karachi and Islamabad arrive in 2-3 working days; the rest of Pakistan takes 3-5 working days. Delivery is free above PKR 10,000.",
      "Support hours: Monday to Friday, 9am to 6pm Pakistan time. Live chat is answered by the AI assistant around the clock.",
      "Bulk and corporate orders: hotels, offices and resellers ordering 20 units or more get a quotation from the sales team within one working day.",
    ].join("\n\n"),
  });
  await api("/api/knowledge-sources", "POST", {
    title: "Product FAQ: Kettle Pro and Toaster TS-300",
    type: "TEXT",
    agentId,
    rawText:
      "The Kettle Pro holds 1.7 litres, boils in about 3 minutes and switches off automatically. The descaling filter can be washed under running water.\n\nThe Toaster TS-300 has 2 wide slots, 7 browning levels and a removable crumb tray. Replacement crumb trays cost PKR 900.",
  });
}

// Tools: order tracking from its template, actions on, intent rule
const tools = await api("/api/tools");
if (!tools.tools.some((tool) => tool.key === "track_order")) {
  const template = tools.templates.find((item) => item.id === "order_tracking").tool;
  await api("/api/tools", "POST", { ...template, agentIds: [agentId] });
}
const allTools = await api("/api/tools");
await api(`/api/ai-agents/${agentId}/tools`, "PUT", {
  toolsEnabled: true,
  toolIds: allTools.tools.map((tool) => tool.id),
  maxToolSteps: 4,
  escalateOnToolFailure: true,
  intentRules: [
    { phrases: ["where is my order", "track my order", "order status"], toolKey: "track_order", mode: "ALWAYS" },
    { phrases: ["book an appointment", "schedule a call"], toolKey: "check_availability", mode: "PREFER" },
  ],
});

// Chatbot: lead form on buying intent (full configuration is saved, as the dashboard does)
const bots = await api("/api/chatbots");
const current = bots.chatbots.find((item) => item.id === bot.id);
await api("/api/chatbots", "POST", {
  ...current,
  id: bot.id,
  agentId,
  requireName: false,
  requireEmail: false,
  aiRepliesEnabled: true,
  replyMode: "ALWAYS",
  leadForm: {
    enabled: true,
    trigger: "ON_INTENT",
    title: "Can our sales team follow up?",
    description: "Leave your details and we'll send you a quotation.",
    allowSkip: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "company", label: "Company", type: "text", required: false },
    ],
  },
});

// Widget conversations (real AI)
const page = await (await fetch(`${BASE}/widget/${bot.widgetId}`, { headers: { Referer: "http://localhost:8080/" } })).text();
const token = page.match(/token\\?":\\?"([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/)[1];
let ipIndex = 50;
async function chat(identity, messages) {
  const ip = `203.0.113.${ipIndex++}`;
  let sessionToken = null;
  let session = null;
  for (const message of messages) {
    const response = await fetch(`${BASE}/api/widget/${bot.widgetId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-assistdesk-widget-token": token, "x-forwarded-for": ip, ...(sessionToken ? { "x-assistdesk-session-token": sessionToken } : {}) },
      body: JSON.stringify({ ...identity, message }),
    });
    const data = await response.json().catch(() => ({}));
    sessionToken = sessionToken ?? data.sessionToken;
    session = data.session?.id ?? session;
    const ai = [...(data.messages ?? [])].reverse().find((item) => item.sender === "AI");
    console.log(`  ${identity.customerName}: ${message}\n    → ${ai ? ai.content.slice(0, 120).replace(/\n/g, " ") : data.leadPrompt ? "[lead form]" : data.error ?? "(no AI reply)"}`);
    await sleep(2500);
  }
  return { sessionToken, session, ip };
}

const existingChats = Number((await q(`select count(*) from "ChatSession" where "chatbotId"=$1`, [bot.id]))[0].count);
let chats = {};
if (existingChats < 3) {
  chats.order = await chat({ customerName: "Ali Raza", customerEmail: "ali.raza@example.com", visitorId: "demo-visitor-ali" }, ["Hi, where is my order 1042?", "Great, thanks! And what is the warranty on the kettle?"]);
  chats.returns = await chat({ customerName: "Hina Shah", customerEmail: "hina.shah@example.com", visitorId: "demo-visitor-hina" }, ["Can I return a toaster I haven't used?", "How long does the refund take?"]);
  const weekday = (() => {
    let ahead = 1;
    const name = (offset) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", weekday: "short" }).format(new Date(Date.now() + offset * 86_400_000));
    while (["Sat", "Sun"].includes(name(ahead))) ahead += 1;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date(Date.now() + ahead * 86_400_000));
  })();
  chats.booking = await chat({ customerName: "Sara Ahmed", customerEmail: "sara.ahmed@example.com", visitorId: "demo-visitor-sara" }, [`Can you book an appointment on ${weekday} at 11:00 to discuss a bulk order? My name is Sara Ahmed.`, "Yes please, go ahead"]);
  chats.lead = await chat({ customerName: "Usman Tariq", visitorId: "demo-visitor-usman" }, ["Hi, I'd like a quotation for 40 kettles for our hotel."]);
  if (chats.lead.sessionToken) {
    await fetch(`${BASE}/api/widget/${bot.widgetId}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-assistdesk-widget-token": token, "x-forwarded-for": chats.lead.ip, "x-assistdesk-session-token": chats.lead.sessionToken },
      body: JSON.stringify({ values: { name: "Usman Tariq", email: "usman.tariq@pearlhotels.example.com", company: "Pearl Hotels" }, consent: true }),
    });
  }
  chats.human = await chat({ customerName: "Ayesha Khan", customerEmail: "ayesha.khan@example.com", visitorId: "demo-visitor-ayesha" }, ["My kettle arrived with a cracked lid, I need help."]);
  if (chats.human.session) {
    await api(`/api/chat-sessions/${chats.human.session}`, "PATCH", { status: "ESCALATED" });
    await api(`/api/chat-sessions/${chats.human.session}/messages`, "POST", { content: "Hi Ayesha, I'm Sana from support. I'm sorry about the lid. I'll send a replacement today; could you share your order number?" });
  }
}

// Feedback on one AI reply
const [aiMessage] = await q(`select m.id, s.id as session from "ChatMessage" m join "ChatSession" s on s.id=m."sessionId" where s."chatbotId"=$1 and m.sender='AI' order by m."createdAt" limit 1`, [bot.id]);
if (aiMessage && chats.order?.sessionToken) {
  await fetch(`${BASE}/api/widget/${bot.widgetId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-assistdesk-widget-token": token, "x-forwarded-for": chats.order.ip, "x-assistdesk-session-token": chats.order.sessionToken },
    body: JSON.stringify({ messageId: aiMessage.id, rating: 1 }),
  });
}

// Tickets
const ticketCount = Number((await q(`select count(*) from "Ticket" where "workspaceId"=$1`, [bot.workspaceId]))[0].count);
if (ticketCount < 6) {
  const tickets = [
    { subject: "Kettle stopped heating after two weeks", previewText: "My Kettle Pro stopped heating. Order 1042.", requesterName: "Bilal Hussain", requesterEmail: "bilal.hussain@example.com", priority: "HIGH", status: "IN_PROGRESS" },
    { subject: "Invoice needed for office purchase", previewText: "Please send a tax invoice for order 1077.", requesterName: "Fatima Noor", requesterEmail: "fatima.noor@example.com", priority: "MEDIUM", status: "OPEN" },
    { subject: "Wrong colour delivered", previewText: "I ordered the black toaster but received white.", requesterName: "Hamza Iqbal", requesterEmail: "hamza.iqbal@example.com", priority: "MEDIUM", status: "RESOLVED" },
    { subject: "Delivery delayed to Multan", previewText: "It has been 6 days and my order hasn't arrived.", requesterName: "Zainab Ali", requesterEmail: "zainab.ali@example.com", priority: "URGENT", status: "OPEN" },
    { subject: "Question about bulk discount", previewText: "Do you offer discounts for 25 units?", requesterName: "Omar Farooq", requesterEmail: "omar.farooq@example.com", priority: "LOW", status: "CLOSED" },
  ];
  for (const ticket of tickets) {
    const created = await api("/api/tickets", "POST", { ...ticket, status: undefined });
    if (created.ticket?.id && ticket.status !== "OPEN") await api(`/api/tickets/${created.ticket.id}`, "PATCH", { status: ticket.status });
  }
}

// Leads and appointments
const leads = await api("/api/leads");
if ((leads.leads ?? leads.items ?? []).length < 3) {
  await api("/api/leads", "POST", { name: "Mariam Siddiqui", email: "mariam@brewhouse.example.com", company: "Brewhouse Cafe", intent: "Wants 12 kettles for a new cafe branch", status: "CONTACTED" });
  await api("/api/leads", "POST", { name: "Kamran Javed", email: "kamran@officehub.example.com", phone: "+923211234567", company: "OfficeHub", intent: "Toasters for 3 office pantries", status: "QUALIFIED" });
}
const slots = await api("/api/appointments/slots");
if (slots.slots?.[3]) {
  await api("/api/appointments", "POST", { startsAt: slots.slots[3].startsAt, name: "Danish Malik", email: "danish.malik@example.com", topic: "Reseller partnership" });
}

console.log("\nsummary:", (await q(`select (select count(*) from "ChatSession" where "workspaceId"=$1) chats, (select count(*) from "Ticket" where "workspaceId"=$1) tickets, (select count(*) from "Lead" where "workspaceId"=$1) leads, (select count(*) from "Appointment" where "workspaceId"=$1) appointments, (select count(*) from "AgentRun" where "workspaceId"=$1) runs, (select count(*) from "ToolExecution" where "workspaceId"=$1) actions`, [bot.workspaceId]))[0]);
await db.end();
