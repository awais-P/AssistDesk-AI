import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { validatePromptTemplateInput } from "@/src/lib/prompt-templates";
import { requireRole } from "@/src/lib/rbac";

type PromptRouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

async function loadPrompt(id: string, workspaceId: string) {
  return prisma.promptTemplate.findFirst({
    where: { id, workspaceId },
    select: { id: true, name: true, body: true },
  });
}

export async function PATCH(request: Request, context: PromptRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const existing = await loadPrompt(id, session.user.workspaceId);

  if (!existing) {
    return NextResponse.json(
      { error: "This prompt no longer exists. Refresh the page to see the latest list." },
      { status: 404 },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as PromptPayload;
  // Fields that are left out keep their current value.
  const input = validatePromptTemplateInput({
    name: typeof payload.name === "undefined" ? existing.name : payload.name,
    body: typeof payload.body === "undefined" ? existing.body : payload.body,
  });

  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const prompt = await prisma.promptTemplate.update({
      where: { id: existing.id },
      data: { name: input.name, body: input.body },
      select: promptSelect,
    });

    return NextResponse.json({ prompt });
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

export async function DELETE(_request: Request, context: PromptRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const existing = await loadPrompt(id, session.user.workspaceId);

  if (!existing) {
    return NextResponse.json(
      { error: "This prompt was already deleted. Refresh the page to see the latest list." },
      { status: 404 },
    );
  }

  await prisma.promptTemplate.delete({ where: { id: existing.id } });

  return NextResponse.json({ success: true });
}
