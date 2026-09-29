import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";

export type WorkspaceSetupState = {
  inboxes: Array<{
    id: string;
    name: string;
    emailPrefix: string;
    senderEmail: string | null;
    autoReplyEnabled: boolean;
  }>;
  agents: Array<{
    id: string;
    name: string;
    inboxId: string | null;
    provider: string;
    model: string;
    systemPrompt: string | null;
    status: string;
  }>;
  knowledgeSources: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    sourceUrl: string | null;
    rawText: string | null;
    fileName: string | null;
    agentId: string | null;
  }>;
  chatbots: Array<{
    id: string;
    name: string;
    agentId: string;
    allowedDomains: string[];
    primaryColor: string;
    welcomeMessage: string | null;
    isActive: boolean;
  }>;
};

export async function getWorkspaceSetupState(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: {
      id: workspaceId,
    },
    include: {
      inboxes: {
        orderBy: {
          createdAt: "asc",
        },
      },
      agents: {
        orderBy: {
          createdAt: "asc",
        },
      },
      knowledgeSources: {
        orderBy: {
          createdAt: "asc",
        },
      },
      chatbots: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const state: WorkspaceSetupState = {
    inboxes: workspace.inboxes.map((inbox) => ({
      id: inbox.id,
      name: inbox.name,
      emailPrefix: inbox.emailPrefix,
      senderEmail: inbox.senderEmail,
      autoReplyEnabled: inbox.autoReplyEnabled,
    })),
    agents: workspace.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      inboxId: agent.inboxId,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      status: agent.status,
    })),
    knowledgeSources: workspace.knowledgeSources.map((source) => ({
      id: source.id,
      title: source.title,
      type: source.type,
      status: source.status,
      sourceUrl: source.sourceUrl,
      rawText: source.rawText,
      fileName: source.fileName,
      agentId: source.agentId,
    })),
    chatbots: workspace.chatbots.map((chatbot) => ({
      id: chatbot.id,
      name: chatbot.name,
      agentId: chatbot.agentId,
      allowedDomains: chatbot.allowedDomains,
      primaryColor: chatbot.primaryColor,
      welcomeMessage: chatbot.welcomeMessage,
      isActive: chatbot.isActive,
    })),
  };

  return state;
}

export function getWorkspaceSetupRedirect(
  state: WorkspaceSetupState | null,
): "/setup" | "/dashboard" {
  if (!state) {
    return "/setup";
  }

  const hasInbox = state.inboxes.length > 0;
  const hasAgent = state.agents.length > 0;
  const hasChatbot = state.chatbots.length > 0;

  if (!hasInbox || !hasAgent || !hasChatbot) {
    return "/setup";
  }

  return "/dashboard";
}

export function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
}

// Subdomains of an allowed domain are accepted automatically, so no wildcards needed.
const DOMAIN_PATTERN = /^(localhost|([a-z0-9-]+\.)+[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})$/;

export function isValidDomain(value: string) {
  return DOMAIN_PATTERN.test(value);
}

/**
 * Widget IDs are public (they appear in the embed snippet), so they include a random
 * suffix: unguessable and unique even when two chatbots share a name.
 */
export function createWidgetId(name: string, workspaceId: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const random = randomBytes(6).toString("hex");

  return `${base || "assistdesk-widget"}-${workspaceId.slice(-4)}${random}`;
}
