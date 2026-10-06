import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { requireRole } from "@/src/lib/rbac";
import { BUILT_IN_BY_KEY } from "@/src/lib/tools/builtin-tools";
import { type HttpToolInput, httpToolData, serializeTool, validateHttpTool } from "@/src/lib/tools/tool-admin";

type ToolRouteContext = { params: Promise<{ id: string }> };

type ToolPatch = HttpToolInput & { agentIds?: unknown };

/**
 * Module 2 FE-3. Managers may switch tools on/off and reword built-in descriptions;
 * changing a custom HTTP tool (URL, credentials) or a confirmation rule needs an Admin.
 */
export async function PATCH(request: Request, context: ToolRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "MANAGER");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const workspaceId = session.user.workspaceId;
  const tool = await prisma.agentTool.findFirst({ where: { id, workspaceId } });

  if (!tool) {
    return NextResponse.json({ error: "Tool not found in this workspace." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as ToolPatch;
  const onlyToggle = Object.keys(body).every((key) => key === "isEnabled");

  if (tool.type === "HTTP" && !onlyToggle) {
    const admin = requireRole(session.user, "ADMIN");

    if (admin) {
      return admin;
    }

    const checked = await validateHttpTool(
      {
        name: body.name ?? tool.name,
        description: body.description ?? tool.description,
        parameters: body.parameters ?? tool.parameters,
        httpMethod: body.httpMethod ?? tool.httpMethod,
        httpUrl: body.httpUrl ?? tool.httpUrl,
        httpHeaders: body.httpHeaders ?? tool.httpHeaders,
        httpBody: body.httpBody === undefined ? tool.httpBody : body.httpBody,
        httpTimeoutMs: body.httpTimeoutMs ?? tool.httpTimeoutMs,
        responseFields: body.responseFields ?? tool.responseFields,
        requiresConfirmation: body.requiresConfirmation ?? tool.requiresConfirmation,
        isEnabled: body.isEnabled ?? tool.isEnabled,
      },
      { existingHeaders: tool.httpHeaders, existingKey: tool.key },
    );

    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    const updated = await prisma.agentTool.update({
      where: { id: tool.id },
      // A changed tool has not been tested in its new form.
      data: { ...httpToolData(checked.value), lastTestStatus: null, lastTestedAt: null },
      include: { bindings: { select: { agentId: true } } },
    });

    return NextResponse.json({ tool: serializeTool(updated) });
  }

  const data: { isEnabled?: boolean; description?: string; requiresConfirmation?: boolean } = {};

  if (typeof body.isEnabled === "boolean") {
    data.isEnabled = body.isEnabled;
  }

  if (tool.type === "BUILT_IN") {
    const definition = tool.builtInKey ? BUILT_IN_BY_KEY.get(tool.builtInKey) : null;

    if (body.description !== undefined) {
      const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";

      if (description && description.length < 15) {
        return NextResponse.json({ error: "Describe when the AI should use this action (at least 15 characters), or leave it empty to restore the default." }, { status: 400 });
      }

      data.description = description || definition?.description || tool.description;
    }

    if (typeof body.requiresConfirmation === "boolean" && body.requiresConfirmation !== tool.requiresConfirmation) {
      const admin = requireRole(session.user, "ADMIN");

      if (admin) {
        return admin;
      }

      if (definition?.effect === "READ" && body.requiresConfirmation) {
        return NextResponse.json({ error: "Lookups don't change anything, so they never need the customer's confirmation." }, { status: 400 });
      }

      data.requiresConfirmation = body.requiresConfirmation;
    }
  }

  const updated = await prisma.agentTool.update({
    where: { id: tool.id },
    data,
    include: { bindings: { select: { agentId: true } } },
  });

  return NextResponse.json({ tool: serializeTool(updated) });
}

/** Only custom tools can be deleted; built-in actions are switched off instead. */
export async function DELETE(_request: Request, context: ToolRouteContext) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const { id } = await context.params;
  const tool = await prisma.agentTool.findFirst({ where: { id, workspaceId: session.user.workspaceId }, select: { id: true, type: true } });

  if (!tool) {
    return NextResponse.json({ error: "Tool not found in this workspace." }, { status: 404 });
  }

  if (tool.type === "BUILT_IN") {
    return NextResponse.json({ error: "Built-in actions can't be deleted. Switch it off instead." }, { status: 400 });
  }

  // Bindings cascade; past executions keep their tool name and key for the action log.
  await prisma.agentTool.deleteMany({ where: { id: tool.id, workspaceId: session.user.workspaceId } });

  return NextResponse.json({ success: true });
}
