import { prisma } from "@/src/lib/prisma";

export const defaultAgentAutomations = [
  {
    key: "block-list",
    title: "Block List",
    description:
      "Ignore tickets from specific emails, domains, or containing keywords.",
    triggerType: "INCOMING",
    summary: "",
    isEnabled: false,
    sortOrder: 1,
  },
  {
    key: "ai-response",
    title: "AI Response",
    description: "Let AI agent generate and send a response to the customer",
    triggerType: "INCOMING",
    summary: "Mode: First reply",
    isEnabled: true,
    sortOrder: 2,
  },
  {
    key: "set-priority",
    title: "Set Priority",
    description: "AI classifies and sets the ticket priority level",
    triggerType: "INCOMING",
    summary: "Levels: low, medium, high, urgent",
    isEnabled: false,
    sortOrder: 3,
  },
  {
    key: "set-tags",
    title: "Set Tags",
    description: "AI classifies and adds tags to the ticket",
    triggerType: "INCOMING",
    summary: "",
    isEnabled: true,
    sortOrder: 4,
  },
  {
    key: "ai-follow-up",
    title: "AI Follow-up",
    description: "Send an AI-generated follow-up email after inactivity",
    triggerType: "SCHEDULED",
    summary: "After 24h of inactivity",
    isEnabled: false,
    sortOrder: 5,
  },
  {
    key: "close-ticket",
    title: "Close Ticket",
    description: "Automatically close the ticket after inactivity",
    triggerType: "SCHEDULED",
    summary: "After 48h of inactivity",
    isEnabled: false,
    sortOrder: 6,
  },
  {
    key: "assign-to",
    title: "Assign To",
    description: "Assign the ticket to a specific team member",
    triggerType: "INCOMING",
    summary: "",
    isEnabled: false,
    sortOrder: 7,
  },
] as const;

export async function ensureAgentAutomationDefaults(
  workspaceId: string,
  agentId: string,
) {
  await prisma.$transaction(
    defaultAgentAutomations.map((automation) =>
      prisma.agentAutomation.upsert({
        where: {
          agentId_key: {
            agentId,
            key: automation.key,
          },
        },
        update: {},
        create: {
          workspaceId,
          agentId,
          key: automation.key,
          title: automation.title,
          description: automation.description,
          triggerType: automation.triggerType,
          summary: automation.summary || null,
          isEnabled: automation.isEnabled,
          sortOrder: automation.sortOrder,
        },
      }),
    ),
  );

  return prisma.agentAutomation.findMany({
    where: {
      workspaceId,
      agentId,
    },
    orderBy: {
      sortOrder: "asc",
    },
  });
}
