import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import {
  MAX_AGENT_MAX_TOKENS,
  MIN_AGENT_MAX_TOKENS,
  clampAgentNumber,
  defaultAgentSystemPrompt,
  getDefaultModelForProvider,
  getModelsForProvider,
  normalizeAgentTone,
  normalizeResponseLength,
  usesCustomApiKey,
} from "@/src/lib/agent-config";
import { serializeAgent } from "@/src/lib/agent-serializer";
import { prisma } from "@/src/lib/prisma";
import { encryptSecret } from "@/src/lib/secrets";

type AgentPayload = {
  id?: string;
  name?: string;
  inboxId?: string | null;
  provider?: string;
  model?: string;
  apiKey?: string | null;
  systemPrompt?: string;
  confidenceThreshold?: number;
  temperature?: number;
  maxTokens?: number;
  tone?: string;
  responseLength?: string;
  status?: string;
};

const agentStatuses = new Set(["DRAFT", "ACTIVE", "ARCHIVED"]);

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const agents = await prisma.aIAgent.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    omit: { apiKey: false },
    include: {
      inbox: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return NextResponse.json({
    agents: agents.map((agent) => ({ ...serializeAgent(agent), inbox: agent.inbox })),
  });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }


  const forbidden = requireRole(session.user, "MANAGER");


  if (forbidden) {

    return forbidden;

  }

  const body = (await request.json().catch(() => ({}))) as AgentPayload;
  const name = body.name?.trim();
  const provider = body.provider?.trim() || "Default";
  const model = body.model?.trim() || getDefaultModelForProvider(provider);
  const availableModels = getModelsForProvider(provider);

  if (!name) {
    return NextResponse.json(
      { error: "Agent name is required." },
      { status: 400 },
    );
  }

  if (name.length > 80) {
    return NextResponse.json(
      { error: "Agent name must be 80 characters or fewer." },
      { status: 400 },
    );
  }

  if (availableModels.length === 0) {
    return NextResponse.json(
      { error: "Selected provider is not supported." },
      { status: 400 },
    );
  }

  if (!availableModels.some((item) => item.value === model)) {
    return NextResponse.json(
      { error: "Selected model is not valid for this provider." },
      { status: 400 },
    );
  }

  if (body.status && !agentStatuses.has(body.status)) {
    return NextResponse.json(
      { error: "Agent status must be DRAFT, ACTIVE or ARCHIVED." },
      { status: 400 },
    );
  }

  const existingAgent = body.id
    ? await prisma.aIAgent.findFirst({
        where: {
          id: body.id,
          workspaceId: session.user.workspaceId,
        },
        select: {
          id: true,
          apiKey: true,
          provider: true,
          status: true,
        },
      })
    : null;

  if (body.id && !existingAgent) {
    return NextResponse.json(
      { error: "AI agent not found in this workspace." },
      { status: 404 },
    );
  }

  // A blank key on edit keeps the stored key, as long as the provider did not change.
  const submittedKey = body.apiKey?.trim() || "";
  const keptKey =
    existingAgent && existingAgent.provider === provider ? existingAgent.apiKey : null;
  const storedKey = usesCustomApiKey(provider)
    ? submittedKey
      ? encryptSecret(submittedKey)
      : keptKey
    : null;

  if (usesCustomApiKey(provider) && !storedKey) {
    return NextResponse.json(
      { error: `Paste your ${provider} API key to use this provider.` },
      { status: 400 },
    );
  }

  if (body.inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: {
        id: body.inboxId,
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
      },
    });

    if (!inbox) {
      return NextResponse.json(
        { error: "Selected inbox was not found for this workspace." },
        { status: 404 },
      );
    }
  }

  const systemPrompt = body.systemPrompt?.trim() || defaultAgentSystemPrompt;

  if (systemPrompt.length > 8192) {
    return NextResponse.json(
      { error: "System prompt must be 8192 characters or fewer." },
      { status: 400 },
    );
  }

  const data = {
    workspaceId: session.user.workspaceId,
    inboxId: body.inboxId || null,
    name,
    provider,
    model,
    apiKey: storedKey,
    systemPrompt,
    confidenceThreshold: clampAgentNumber(body.confidenceThreshold, {
      min: 0,
      max: 1,
      fallback: 0.5,
    }),
    temperature: clampAgentNumber(body.temperature, { min: 0, max: 1, fallback: 0.7 }),
    maxTokens: Math.round(
      clampAgentNumber(body.maxTokens, {
        min: MIN_AGENT_MAX_TOKENS,
        max: MAX_AGENT_MAX_TOKENS,
        fallback: 512,
      }),
    ),
    tone: normalizeAgentTone(body.tone),
    responseLength: normalizeResponseLength(body.responseLength),
    status: (body.status || existingAgent?.status || "ACTIVE") as
      | "DRAFT"
      | "ACTIVE"
      | "ARCHIVED",
  };

  const agent = existingAgent
    ? await prisma.aIAgent.update({
        where: {
          id: existingAgent.id,
        },
        data,
        omit: { apiKey: false },
        include: {
          inbox: true,
        },
      })
    : await prisma.aIAgent.create({
        data,
        omit: { apiKey: false },
        include: {
          inbox: true,
        },
      });

  return NextResponse.json({
    agent: { ...serializeAgent(agent), inbox: agent.inbox },
  });
}
