import { randomBytes } from "node:crypto";
import { ensureAgentAutomationDefaults } from "./agent-automations";
import { generateTemporaryPassword, hashPassword } from "./auth";
import { startTrial } from "./billing";
import { processKnowledgeSourceById } from "./knowledge-indexing";
import { prisma } from "./prisma";
import { createWidgetId } from "./setup";
import { ensureBuiltInTools } from "./tools/registry";

/**
 * A ready-made test workspace with one of everything (agent, chatbot, knowledge, chats,
 * ticket, lead, escalation, appointment, ...), so a deployed site can be tried without
 * creating each piece by hand. Created on request by the server's operator (see
 * `app/api/admin/sample-workspace`); the logins use the reserved `.test` domain.
 */
export const SAMPLE_WORKSPACE_SLUG = "assistdesk-sample";
export const SAMPLE_OWNER_EMAIL = "owner@assistdesk.test";
export const SAMPLE_AGENT_EMAIL = "agent@assistdesk.test";

const SAMPLE_MODEL = "openrouter/google/gemma-4-31b-it:free";

const STORE_POLICIES = `Northwind Gadgets - store policies and FAQ

Shipping: orders ship within 1 business day. Standard delivery takes 3-5 business days and is free over $50; express delivery takes 1-2 business days and costs $12.

Returns: unused items can be returned within 30 days of delivery for a full refund. Start a return from the order page or ask support. Refunds reach the original payment method within 5-7 business days.

Warranty: all gadgets have a 1-year warranty against manufacturing defects. Accidental damage is not covered.

Order tracking: every order gets a tracking link by email once it ships. Customers can also give support their order number (for example #1042) to get the status.

Support hours: Monday to Friday, 9:00-18:00 (UTC+5). Outside these hours the AI assistant answers and a person follows up the next working day.

Payment: we accept Visa, Mastercard and PayPal. Prices include tax.`;

export type SampleWorkspaceResult = {
  created: boolean;
  workspaceId: string;
  logins: Array<{ role: string; email: string; password: string }>;
  knowledgeStatus: string | null;
};

function hoursAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function appHost() {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").hostname;
  } catch {
    return "localhost";
  }
}

/**
 * Creates the sample workspace, or, when it already exists, gives both logins a new
 * password (so a lost password can always be recovered) and leaves the data alone.
 */
export async function createSampleWorkspace({
  now = new Date(),
  indexKnowledge = true,
}: { now?: Date; indexKnowledge?: boolean } = {}): Promise<SampleWorkspaceResult> {
  const ownerPassword = generateTemporaryPassword();
  const agentPassword = generateTemporaryPassword();
  const existing = await prisma.workspace.findUnique({
    where: { slug: SAMPLE_WORKSPACE_SLUG },
    select: { id: true },
  });

  if (existing) {
    for (const [email, password] of [
      [SAMPLE_OWNER_EMAIL, ownerPassword],
      [SAMPLE_AGENT_EMAIL, agentPassword],
    ] as const) {
      await prisma.user.updateMany({
        where: { workspaceId: existing.id, email },
        data: { passwordHash: await hashPassword(password), isEmailVerified: true },
      });
    }

    return {
      created: false,
      workspaceId: existing.id,
      logins: [
        { role: "Owner", email: SAMPLE_OWNER_EMAIL, password: ownerPassword },
        { role: "Agent", email: SAMPLE_AGENT_EMAIL, password: agentPassword },
      ],
      knowledgeStatus: null,
    };
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: "Northwind Gadgets (sample)",
      slug: SAMPLE_WORKSPACE_SLUG,
      supportEmail: "support@assistdesk.test",
      settings: { create: { supportSignature: "Northwind Gadgets Support" } },
    },
    select: { id: true },
  });
  const workspaceId = workspace.id;

  try {
    const [owner, teammate] = await Promise.all([
      prisma.user.create({
        data: {
          workspaceId,
          fullName: "Sample Owner",
          username: "sample-owner",
          email: SAMPLE_OWNER_EMAIL,
          passwordHash: await hashPassword(ownerPassword),
          role: "OWNER",
          isEmailVerified: true,
          emailVerified: now,
        },
        select: { id: true, fullName: true },
      }),
      prisma.user.create({
        data: {
          workspaceId,
          fullName: "Sara Agent",
          username: "sample-agent",
          email: SAMPLE_AGENT_EMAIL,
          passwordHash: await hashPassword(agentPassword),
          role: "AGENT",
          isEmailVerified: true,
          emailVerified: now,
        },
        select: { id: true, fullName: true },
      }),
    ]);

    // Setup: inbox, agent (with its automations and tools), chatbot and knowledge.
    const inbox = await prisma.inbox.create({
      data: {
        workspaceId,
        name: "Support",
        emailPrefix: `support-sample-${randomBytes(3).toString("hex")}`,
        ticketPrefix: "NW",
        senderName: "Northwind Gadgets Support",
      },
      select: { id: true },
    });
    const agent = await prisma.aIAgent.create({
      data: {
        workspaceId,
        inboxId: inbox.id,
        name: "Store Assistant",
        provider: "Default",
        model: SAMPLE_MODEL,
        systemPrompt:
          "You are the support assistant for Northwind Gadgets, an online gadget store. Answer from the store policies, keep replies short and friendly, and offer a human when you are unsure.",
        status: "ACTIVE",
        toolsEnabled: true,
      },
      select: { id: true },
    });
    await ensureAgentAutomationDefaults(workspaceId, agent.id);
    await ensureBuiltInTools(workspaceId);
    const tools = await prisma.agentTool.findMany({ where: { workspaceId }, select: { id: true } });
    await prisma.agentToolBinding.createMany({
      data: tools.map((tool) => ({ agentId: agent.id, toolId: tool.id })),
      skipDuplicates: true,
    });

    const chatbot = await prisma.chatbot.create({
      data: {
        workspaceId,
        agentId: agent.id,
        name: "Website Chat",
        widgetId: createWidgetId("Website Chat", workspaceId),
        welcomeMessage: "Hi! I'm the Northwind assistant. Ask me about orders, shipping or returns.",
        allowedDomains: [appHost(), "localhost"],
        conversationStarters: ["Where is my order?", "What is your return policy?"],
      },
      select: { id: true },
    });
    const knowledge = await prisma.knowledgeSource.create({
      data: {
        workspaceId,
        agentId: agent.id,
        title: "Store policies and FAQ",
        type: "TEXT",
        rawText: STORE_POLICIES,
      },
      select: { id: true },
    });
    await prisma.cannedResponse.create({
      data: {
        workspaceId,
        title: "Shipping times",
        body: "Hi {{customer_name}}, orders ship within 1 business day and arrive in 3-5 business days.",
      },
    });
    const tag = await prisma.tag.create({ data: { workspaceId, name: "Shipping", color: "#f59e0b" } });
    await prisma.promptTemplate.create({
      data: {
        workspaceId,
        name: "Friendly and short",
        body: "Reply in two or three friendly sentences and end with a question if something is unclear.",
        createdById: owner.id,
      },
    });
    await prisma.integration.create({
      data: {
        workspaceId,
        inboxId: inbox.id,
        agentId: agent.id,
        type: "EMAIL",
        name: "Support email (forwarded)",
        provider: "Forwarded Inbox",
        status: "CONNECTED",
        supportAddress: "support@assistdesk.test",
        webhookSecret: randomBytes(24).toString("hex"),
        config: { autoCreateTickets: true, syncReplies: true },
      },
    });

    // A customer with a website chat (which became a lead) and a WhatsApp chat (escalated).
    const contact = await prisma.contact.create({
      data: {
        workspaceId,
        name: "Ali Khan",
        email: "ali.khan@example.com",
        phone: "+923001234567",
        whatsappId: "923001234567",
        lastChannel: "WHATSAPP",
        memory: "Ordered a pair of wireless earbuds (#1042). Interested in a bulk order for his office.",
        firstSeenAt: hoursAgo(now, 30),
        lastSeenAt: hoursAgo(now, 2),
      },
      select: { id: true },
    });
    const webChat = await prisma.chatSession.create({
      data: {
        workspaceId,
        chatbotId: chatbot.id,
        contactId: contact.id,
        channel: "WEB_WIDGET",
        status: "CLOSED",
        customerName: "Ali Khan",
        customerEmail: "ali.khan@example.com",
        startedAt: hoursAgo(now, 26),
        lastActivityAt: hoursAgo(now, 25.8),
        endedAt: hoursAgo(now, 25.5),
        closedReason: "idle",
        summary: "Ali asked about shipping times and a bulk order of 20 earbuds for his office.",
        messageCount: 4,
        aiMessageCount: 2,
      },
      select: { id: true },
    });
    const webMessages = [
      { sender: "USER" as const, content: "Hi, how long does shipping take?" },
      {
        sender: "AI" as const,
        content: "Orders ship within 1 business day and standard delivery takes 3-5 business days (free over $50).",
      },
      { sender: "USER" as const, content: "Great. Do you do bulk orders? I need 20 earbuds for my office." },
      {
        sender: "AI" as const,
        content: "Yes! I've passed your request to our sales team, and they'll email you a quote today.",
      },
    ];
    let firstAiMessageId: string | null = null;

    for (const [index, message] of webMessages.entries()) {
      const row = await prisma.chatMessage.create({
        data: { sessionId: webChat.id, ...message, createdAt: new Date(hoursAgo(now, 26).getTime() + index * 60_000) },
        select: { id: true },
      });

      if (message.sender === "AI") {
        firstAiMessageId ??= row.id;
        await prisma.aiInteraction.create({
          data: {
            workspaceId,
            agentId: agent.id,
            chatbotId: chatbot.id,
            sessionId: webChat.id,
            messageId: row.id,
            channel: "WEB_WIDGET",
            question: webMessages[index - 1]?.content ?? "",
            latencyMs: 900 + index * 150,
            tokens: 180,
            model: SAMPLE_MODEL,
            provider: "openrouter",
            confidence: 0.82,
            grounded: true,
            sourceIds: [knowledge.id],
            createdAt: new Date(hoursAgo(now, 26).getTime() + index * 60_000),
          },
        });
      }
    }

    if (firstAiMessageId) {
      await prisma.messageFeedback.create({
        data: { workspaceId, messageId: firstAiMessageId, sessionId: webChat.id, rating: 1 },
      });
    }

    const lead = await prisma.lead.create({
      data: {
        workspaceId,
        chatbotId: chatbot.id,
        sessionId: webChat.id,
        contactId: contact.id,
        ownerId: owner.id,
        name: "Ali Khan",
        email: "ali.khan@example.com",
        phone: "+923001234567",
        company: "Khan Traders",
        intent: "Bulk order of 20 wireless earbuds",
        source: "AUTO",
        channel: "WEB_WIDGET",
        status: "QUALIFIED",
        score: 78,
        pageHost: appHost(),
        lastActivityAt: hoursAgo(now, 25.8),
      },
      select: { id: true },
    });
    await prisma.leadEvent.createMany({
      data: [
        { workspaceId, leadId: lead.id, type: "CREATED", detail: "Captured from the website chat.", actorName: "AI" },
        {
          workspaceId,
          leadId: lead.id,
          type: "STATUS_CHANGED",
          detail: "New → Qualified",
          actorName: owner.fullName,
        },
      ],
    });

    const whatsappChat = await prisma.chatSession.create({
      data: {
        workspaceId,
        contactId: contact.id,
        previousSessionId: webChat.id,
        channel: "WHATSAPP",
        status: "ESCALATED",
        customerName: "Ali Khan",
        customerPhone: "+923001234567",
        startedAt: hoursAgo(now, 2.2),
        lastActivityAt: hoursAgo(now, 2),
        messageCount: 3,
        aiMessageCount: 1,
      },
      select: { id: true },
    });
    await prisma.chatMessage.createMany({
      data: [
        { sessionId: whatsappChat.id, sender: "USER", content: "My order #1042 still hasn't arrived, it's been 8 days!", createdAt: hoursAgo(now, 2.2), sentiment: -0.6 },
        { sessionId: whatsappChat.id, sender: "AI", content: "I'm sorry about the delay. Let me connect you with a member of our team who can check with the courier.", createdAt: hoursAgo(now, 2.15) },
        { sessionId: whatsappChat.id, sender: "SYSTEM", content: "Conversation handed over to the support team.", createdAt: hoursAgo(now, 2.1) },
      ],
    });

    // The delayed order also became an email ticket, assigned to the agent.
    const ticket = await prisma.ticket.create({
      data: {
        workspaceId,
        inboxId: inbox.id,
        assigneeId: teammate.id,
        createdById: owner.id,
        contactId: contact.id,
        ticketNumber: 1,
        subject: "Order #1042 has not arrived",
        previewText: "My order #1042 still hasn't arrived, it's been 8 days.",
        requesterName: "Ali Khan",
        requesterEmail: "ali.khan@example.com",
        source: "EMAIL",
        status: "IN_PROGRESS",
        priority: "HIGH",
        createdAt: hoursAgo(now, 3),
      },
      select: { id: true },
    });
    await prisma.ticketMessage.createMany({
      data: [
        { workspaceId, ticketId: ticket.id, sender: "USER", authorName: "Ali Khan", content: "Hello, my order #1042 still hasn't arrived and it's been 8 days. Can you check?", createdAt: hoursAgo(now, 3) },
        { workspaceId, ticketId: ticket.id, sender: "AGENT", authorName: teammate.fullName, content: "Hi Ali, sorry for the wait. I've asked the courier and will update you within 24 hours.", createdAt: hoursAgo(now, 1) },
      ],
    });
    await prisma.ticketTag.create({ data: { ticketId: ticket.id, tagId: tag.id } });

    await prisma.escalation.create({
      data: {
        workspaceId,
        sessionId: whatsappChat.id,
        ticketId: ticket.id,
        contactId: contact.id,
        channel: "WHATSAPP",
        trigger: "SENTIMENT",
        reason: "The customer is upset about a late order.",
        sentimentScore: -0.6,
        priority: "HIGH",
        status: "PENDING",
        summary: "Ali Khan's order #1042 is 8 days late and he is frustrated. He has an open bulk-order lead; handle with care.",
        summaryGeneratedAt: hoursAgo(now, 2.1),
        slaDueAt: new Date(now.getTime() + 30 * 60 * 1000),
        createdAt: hoursAgo(now, 2.1),
      },
    });

    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(6, 0, 0, 0);
    await prisma.appointment.create({
      data: {
        workspaceId,
        contactId: contact.id,
        sessionId: webChat.id,
        name: "Ali Khan",
        email: "ali.khan@example.com",
        topic: "Bulk order call",
        startsAt: tomorrow,
      },
    });

    // A refund request waiting for approval. No conversation or email is attached, so
    // deciding it in a demo never messages anyone.
    await prisma.refundRequest.create({
      data: {
        workspaceId,
        contactId: contact.id,
        orderNumber: "1042",
        source: "MANUAL",
        amount: 8500,
        currency: "PKR",
        reason: "The left earbud stopped charging after two days.",
        customerName: "Ali Khan",
        createdAt: hoursAgo(now, 1.5),
      },
    });

    await prisma.customRole.create({
      data: {
        workspaceId,
        name: "Support Lead",
        description: "An agent who can also assign escalations and see the audit log.",
        baseRole: "AGENT",
        permissions: ["tickets.handle", "escalations.assign", "audit.view"],
      },
    });
    // Saved but switched off: the address is a placeholder until a real one is entered.
    await prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        name: "CRM (example)",
        url: "https://example.com/assistdesk-webhook",
        secret: randomBytes(24).toString("hex"),
        isActive: false,
      },
    });
    await prisma.notification.create({
      data: {
        workspaceId,
        type: "SAMPLE_DATA",
        title: "Sample workspace ready",
        body: "This workspace has one of everything to try. Open Chats, Tickets, Leads and Escalations to explore.",
        link: "/dashboard",
      },
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        actorType: "SYSTEM",
        actorName: "AssistDesk",
        action: "workspace.sample_created",
        category: "settings",
        summary: "Sample workspace created",
      },
    });
    await startTrial(workspaceId, now);

    let knowledgeStatus: string | null = "PENDING";

    if (indexKnowledge) {
      try {
        await processKnowledgeSourceById(knowledge.id);
      } catch (error) {
        console.error("[sample] Knowledge indexing failed:", error);
      }

      knowledgeStatus =
        (await prisma.knowledgeSource.findUnique({ where: { id: knowledge.id }, select: { status: true } }))?.status ??
        null;
    }

    return {
      created: true,
      workspaceId,
      logins: [
        { role: "Owner", email: SAMPLE_OWNER_EMAIL, password: ownerPassword },
        { role: "Agent", email: SAMPLE_AGENT_EMAIL, password: agentPassword },
      ],
      knowledgeStatus,
    };
  } catch (error) {
    // Everything hangs off the workspace (cascading deletes), so one delete undoes it all.
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {});
    throw error;
  }
}

/** Deletes the sample workspace and everything in it. */
export async function deleteSampleWorkspace() {
  const result = await prisma.workspace.deleteMany({ where: { slug: SAMPLE_WORKSPACE_SLUG } });
  return result.count > 0;
}
