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
): "/setup" | "/dashboard/tickets" {
  if (!state) {
    return "/setup";
  }

  const hasInbox = state.inboxes.length > 0;
  const hasAgent = state.agents.length > 0;
  const hasChatbot = state.chatbots.length > 0;

  if (!hasInbox || !hasAgent || !hasChatbot) {
    return "/setup";
  }

  return "/dashboard/tickets";
}

export function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function createWidgetId(name: string, workspaceId: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `${base || "assistdesk-widget"}-${workspaceId.slice(-6)}`;
}
