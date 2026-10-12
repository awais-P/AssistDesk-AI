import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { defaultPromptTemplates, validatePromptTemplateInput } from "@/src/lib/prompt-templates";
import { requireRole } from "@/src/lib/rbac";

type PromptPayload = {
  name?: unknown;
  body?: unknown;
};

const promptSelect = {
  id: true,
  name: true,
  body: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const existingCount = await prisma.promptTemplate.count({ where: { workspaceId } });

  if (existingCount === 0) {
    await prisma.promptTemplate.createMany({
      data: defaultPromptTemplates.map((template) => ({
        workspaceId,
        name: template.name,
        body: template.body,
      })),
      skipDuplicates: true,
    });
  }

  const prompts = await prisma.promptTemplate.findMany({
    where: { workspaceId },
    select: promptSelect,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ prompts });
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

  const payload = (await request.json().catch(() => ({}))) as PromptPayload;
  const input = validatePromptTemplateInput(payload);

  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const prompt = await prisma.promptTemplate.create({
      data: {
        workspaceId: session.user.workspaceId,
        name: input.name,
        body: input.body,
        createdById: session.user.id,
      },
      select: promptSelect,
    });

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: `A prompt named "${input.name}" already exists. Choose a different name.` },
        { status: 409 },
      );
    }

    throw error;
  }
}
