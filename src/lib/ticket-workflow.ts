import { ensureAgentAutomationDefaults } from "./agent-automations";
import { estimateTokenUsage, hydrateKnowledgeSources } from "./knowledge-runtime";
import { generateAgentReply } from "./llm-runtime";
import { prisma } from "./prisma";

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function buildTicketContext(ticket: {
  subject: string;
  previewText: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
}) {
  return [
    ticket.subject,
    ticket.previewText,
    ticket.requesterName,
    ticket.requesterEmail,
  ]
    .filter(Boolean)
    .join("\n");
}

function classifyPriority(value: string) {
  const content = normalize(value);

  if (
    /(urgent|immediately|asap|critical|outage|down|security|breach|cannot login|locked out)/.test(
      content,
    )
  ) {
    return "URGENT" as const;
  }

  if (
    /(high|error|bug|broken|refund|payroll|payment|invoice|unable|failed|cannot access)/.test(
      content,
    )
  ) {
    return "HIGH" as const;
  }

  if (/(question|follow up|clarify|leave|schedule|request)/.test(content)) {
    return "MEDIUM" as const;
  }

  return "LOW" as const;
}

function deriveTagNames(value: string) {
  const content = normalize(value);
  const tagMap: Array<{ name: string; pattern: RegExp }> = [
    { name: "billing", pattern: /(billing|invoice|payment|refund|charge)/ },
    { name: "technical", pattern: /(error|bug|issue|technical|broken|failed)/ },
    { name: "account", pattern: /(account|login|password|access|locked)/ },
    { name: "leave", pattern: /(leave|vacation|time off)/ },
    { name: "payroll", pattern: /(payroll|salary|payslip)/ },
    { name: "sales", pattern: /(quote|pricing|sales|demo)/ },
    { name: "urgent", pattern: /(urgent|asap|critical|immediately)/ },
  ];

  return tagMap
    .filter((entry) => entry.pattern.test(content))
    .map((entry) => entry.name);
}

async function ensureTagAssignments(workspaceId: string, ticketId: string, names: string[]) {
  if (names.length === 0) {
    return [];
  }

  const uniqueNames = Array.from(new Set(names));

  const tags = await Promise.all(
    uniqueNames.map((name) =>
      prisma.tag.upsert({
        where: {
          workspaceId_name: {
            workspaceId,
            name,
          },
        },
        update: {},
        create: {
          workspaceId,
          name,
          color: "#f59e0b",
        },
      }),
    ),
  );

  await Promise.all(
    tags.map((tag) =>
      prisma.ticketTag.upsert({
        where: {
          ticketId_tagId: {
            ticketId,
            tagId: tag.id,
          },
        },
        update: {},
        create: {
          ticketId,
          tagId: tag.id,
        },
      }),
    ),
  );

  return tags;
}

async function resolveAssignedUser({
  workspaceId,
  currentAssigneeId,
  summary,
}: {
  workspaceId: string;
  currentAssigneeId: string | null;
  summary: string | null;
}) {
  const normalizedSummary = normalize(summary);

  if (normalizedSummary) {
    const matchingUser = await prisma.user.findFirst({
      where: {
        workspaceId,
        isActive: true,
        OR: [
          { email: normalizedSummary },
          { username: normalizedSummary },
          { fullName: { equals: normalizedSummary, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
      },
    });

    if (matchingUser) {
      return matchingUser.id;
    }
  }

  if (currentAssigneeId) {
    return currentAssigneeId;
  }

  const fallbackUser = await prisma.user.findFirst({
    where: {
      workspaceId,
      isActive: true,
      role: {
        in: ["AGENT", "MANAGER", "ADMIN", "OWNER"],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  return fallbackUser?.id ?? null;
}

async function createAutomationLog(data: {
  workspaceId: string;
  ticketId: string;
  agentId?: string | null;
  action: string;
  status: string;
  model?: string | null;
  tokens?: number;
  durationMs?: number;
  summary?: string | null;
}) {
  await prisma.automationLog.create({
    data: {
      workspaceId: data.workspaceId,
      ticketId: data.ticketId,
      agentId: data.agentId || null,
      action: data.action,
      status: data.status,
      model: data.model || null,
      tokens: data.tokens ?? 0,
      durationMs: data.durationMs ?? 0,
      summary: data.summary || null,
    },
  });
}

export async function processIncomingTicket(ticketId: string) {
  const workflowStart = Date.now();

  const ticket = await prisma.ticket.findUnique({
    where: {
      id: ticketId,
    },
    include: {
      inbox: true,
      assignee: true,
      ticketTags: true,
    },
  });

  if (!ticket) {
    return { processed: false, reason: "Ticket not found." };
  }

  const agent =
    (ticket.inboxId
      ? await prisma.aIAgent.findFirst({
          where: {
            workspaceId: ticket.workspaceId,
            inboxId: ticket.inboxId,
            status: "ACTIVE",
          },
          include: {
            knowledgeSources: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        })
      : null) ||
    (await prisma.aIAgent.findFirst({
      where: {
        workspaceId: ticket.workspaceId,
        status: "ACTIVE",
      },
      include: {
        knowledgeSources: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    }));

  if (!agent) {
    await createAutomationLog({
      workspaceId: ticket.workspaceId,
      ticketId: ticket.id,
      action: "AGENT_ROUTING",
      status: "SKIPPED",
      summary: "No active AI agent is linked to this workspace or inbox.",
      durationMs: Date.now() - workflowStart,
    });

    return { processed: false, reason: "No active AI agent found." };
  }

  const automations = await ensureAgentAutomationDefaults(ticket.workspaceId, agent.id);
  const context = buildTicketContext(ticket);
  const ticketUpdate: {
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
    assigneeId?: string | null;
  } = {};

  if (!ticket.assigneeId) {
    ticketUpdate.assigneeId = await resolveAssignedUser({
      workspaceId: ticket.workspaceId,
      currentAssigneeId: ticket.assigneeId,
      summary: null,
    });
  }

  const enabledAutomations = automations.filter((automation) => automation.isEnabled);

  for (const automation of enabledAutomations) {
    const startedAt = Date.now();

    if (automation.key === "set-priority") {
      const priority = classifyPriority(context);

      if (priority !== ticket.priority) {
        ticketUpdate.priority = priority;
      }

      await createAutomationLog({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        agentId: agent.id,
        action: "SET_PRIORITY",
        status: "SUCCESS",
        model: agent.model,
        summary: `Priority classified as ${priority}.`,
        durationMs: Date.now() - startedAt,
      });
      continue;
    }

    if (automation.key === "set-tags") {
      const tags = await ensureTagAssignments(
        ticket.workspaceId,
        ticket.id,
        deriveTagNames(context),
      );

      await createAutomationLog({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        agentId: agent.id,
        action: "SET_TAGS",
        status: tags.length > 0 ? "SUCCESS" : "SKIPPED",
        model: agent.model,
        summary:
          tags.length > 0
            ? `Applied tags: ${tags.map((tag) => tag.name).join(", ")}.`
            : "No matching tags were identified from the ticket content.",
        durationMs: Date.now() - startedAt,
      });
      continue;
    }

    if (automation.key === "assign-to") {
      const assigneeId = await resolveAssignedUser({
        workspaceId: ticket.workspaceId,
        currentAssigneeId: ticketUpdate.assigneeId ?? ticket.assigneeId,
        summary: automation.summary,
      });

      if (assigneeId) {
        ticketUpdate.assigneeId = assigneeId;
      }

      await createAutomationLog({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        agentId: agent.id,
        action: "ASSIGN_TO",
        status: assigneeId ? "SUCCESS" : "SKIPPED",
        model: agent.model,
        summary: assigneeId
          ? "Ticket was assigned to an active workspace member."
          : "No eligible assignee could be found.",
        durationMs: Date.now() - startedAt,
      });
      continue;
    }

    if (automation.key === "ai-response") {
      const hydratedSources = await hydrateKnowledgeSources(
        agent.knowledgeSources.map((source) => ({
          id: source.id,
          title: source.title,
          type: source.type,
          status: source.status,
          sourceUrl: source.sourceUrl,
          rawText: source.rawText,
        })),
      );

      const response = await generateAgentReply({
        agent: {
          provider: agent.provider,
          model: agent.model,
          apiKey: agent.apiKey,
          systemPrompt: agent.systemPrompt,
          confidenceThreshold: agent.confidenceThreshold,
        },
        question: context,
        sources: hydratedSources,
      });

      await prisma.ticketMessage.create({
        data: {
          workspaceId: ticket.workspaceId,
          ticketId: ticket.id,
          sender: response.confidence >= agent.confidenceThreshold ? "AI" : "SYSTEM",
          content:
            response.confidence >= agent.confidenceThreshold
              ? response.reply
              : `AI confidence was too low for a full automatic answer.\n\n${response.reply}`,
        },
      });

      ticketUpdate.status = "IN_PROGRESS";

      await createAutomationLog({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        agentId: agent.id,
        action: "AI_RESPONSE",
        status:
          response.usedFallback
            ? "FALLBACK"
            : response.confidence >= agent.confidenceThreshold
              ? "SUCCESS"
              : "ESCALATED",
        model: agent.model,
        tokens: response.tokens,
        summary: `Confidence ${response.confidence.toFixed(2)} with provider ${agent.provider}.`,
        durationMs: Date.now() - startedAt,
      });
      continue;
    }

    if (automation.key === "block-list") {
      const rules = normalize(automation.summary);
      const requesterEmail = normalize(ticket.requesterEmail);

      if (rules && requesterEmail && rules.includes(requesterEmail)) {
        ticketUpdate.status = "CLOSED";
      }

      await createAutomationLog({
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        agentId: agent.id,
        action: "BLOCK_LIST",
        status:
          rules && requesterEmail && rules.includes(requesterEmail)
            ? "SUCCESS"
            : "SKIPPED",
        model: agent.model,
        summary:
          rules && requesterEmail && rules.includes(requesterEmail)
            ? "Ticket matched the block list and was closed."
            : "No block-list rule matched this ticket.",
        durationMs: Date.now() - startedAt,
      });
      continue;
    }
  }

  await prisma.ticket.update({
    where: {
      id: ticket.id,
    },
    data: ticketUpdate,
  });

  await createAutomationLog({
    workspaceId: ticket.workspaceId,
    ticketId: ticket.id,
    agentId: agent.id,
    action: "INCOMING_WORKFLOW",
    status: "SUCCESS",
    model: agent.model,
    tokens: estimateTokenUsage(context),
    summary: `${enabledAutomations.length} enabled automation(s) were evaluated for this ticket.`,
    durationMs: Date.now() - workflowStart,
  });

  return {
    processed: true,
    agentId: agent.id,
  };
}
