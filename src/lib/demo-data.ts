import { hashPassword } from "./auth";
import { prisma } from "./prisma";

export async function ensureDemoData() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "DATABASE_URL is not configured. Skipping demo data seeding.",
    );
    return;
  }

  let workspace = await prisma.workspace.findFirst({
    where: {
      slug: "assistdesk-demo",
    },
    include: {
      users: true,
      inboxes: true,
      agents: true,
      chatbots: true,
      tags: true,
      tickets: true,
    },
  });

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "AssistDesk Demo Workspace",
        slug: "assistdesk-demo",
        supportEmail: "support@assistdesk.local",
      },
      include: {
        users: true,
        inboxes: true,
        agents: true,
        chatbots: true,
        tags: true,
        tickets: true,
      },
    });
  }

  let adminUser = workspace.users[0];

  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        workspaceId: workspace.id,
        fullName: "Muhammad Awais",
        username: "admin",
        email: "admin@assistdesk.local",
        passwordHash: hashPassword("admin"),
        role: "ADMIN",
      },
    });
  } else if (adminUser.passwordHash === "admin") {
    adminUser = await prisma.user.update({
      where: { id: adminUser.id },
      data: {
        passwordHash: hashPassword("admin"),
      },
    });
  }

  let inbox = workspace.inboxes[0];

  if (!inbox) {
    inbox = await prisma.inbox.create({
      data: {
        workspaceId: workspace.id,
        name: "Support",
        emailPrefix: "support.assistdesk",
        ticketPrefix: "AD",
        autoReplyEnabled: true,
        senderEmail: "support@assistdesk.local",
      },
    });
  }

  let agent = workspace.agents[0];

  if (!agent) {
    agent = await prisma.aIAgent.create({
      data: {
        workspaceId: workspace.id,
        inboxId: inbox.id,
        name: "Support Assistant",
        provider: "Groq",
        model: "llama-3.3-70b-versatile",
        systemPrompt:
          "You are AssistDesk support assistant. Keep answers clear and helpful.",
        status: "ACTIVE",
      },
    });
  }

  if (workspace.chatbots.length === 0) {
    await prisma.chatbot.create({
      data: {
        workspaceId: workspace.id,
        agentId: agent.id,
        name: "Website Support Bot",
        widgetId: "assistdesk-widget-demo",
        welcomeMessage: "Hello, how can I help you today?",
        allowedDomains: ["localhost", "127.0.0.1"],
        primaryColor: "#111111",
        isActive: true,
      },
    });
  }

  if (workspace.tags.length === 0) {
    await prisma.tag.createMany({
      data: [
        {
          workspaceId: workspace.id,
          name: "leave",
          color: "#facc15",
        },
        {
          workspaceId: workspace.id,
          name: "web",
          color: "#60a5fa",
        },
      ],
    });
  }

  const ticketCount = await prisma.ticket.count({
    where: {
      workspaceId: workspace.id,
    },
  });

  if (ticketCount === 0) {
    await prisma.ticket.createMany({
      data: [
        {
          workspaceId: workspace.id,
          inboxId: inbox.id,
          assigneeId: adminUser.id,
          createdById: adminUser.id,
          ticketNumber: 458103,
          subject: "Hello",
          previewText: "Regarding Leave",
          requesterName: "ahmad",
          requesterEmail: "ahmad@example.com",
          source: "WEB",
          status: "OPEN",
          priority: "MEDIUM",
          createdAt: new Date("2026-04-04T10:00:00Z"),
        },
        {
          workspaceId: workspace.id,
          inboxId: inbox.id,
          assigneeId: adminUser.id,
          createdById: adminUser.id,
          ticketNumber: 458104,
          subject: "Need access to payroll portal",
          previewText: "Unable to access the internal payroll page",
          requesterName: "sarah",
          requesterEmail: "sarah@example.com",
          source: "EMAIL",
          status: "IN_PROGRESS",
          priority: "HIGH",
          createdAt: new Date("2026-04-06T12:30:00Z"),
        },
      ],
    });

    const [leaveTag, webTag] = await prisma.tag.findMany({
      where: {
        workspaceId: workspace.id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const tickets = await prisma.ticket.findMany({
      where: {
        workspaceId: workspace.id,
      },
      orderBy: {
        ticketNumber: "asc",
      },
    });

    if (tickets[0] && leaveTag) {
      await prisma.ticketTag.create({
        data: {
          ticketId: tickets[0].id,
          tagId: leaveTag.id,
        },
      });
    }

    if (tickets[0] && webTag) {
      await prisma.ticketTag.create({
        data: {
          ticketId: tickets[0].id,
          tagId: webTag.id,
        },
      });
    }
  }
}
