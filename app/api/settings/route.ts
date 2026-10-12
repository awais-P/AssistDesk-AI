import { requireRole } from "@/src/lib/rbac";
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type SettingsPayload = {
  workspaceName?: string;
  supportEmail?: string;
  timezone?: string;
  theme?: string;
  supportSignature?: string;
  /** Module 5: let the AI use what a customer said on other channels. */
  crossChannelMemory?: boolean;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const forbidden = requireRole(session.user, "ADMIN");

  if (forbidden) {
    return forbidden;
  }

  const body = (await request.json()) as SettingsPayload;
  const workspaceName = body.workspaceName?.trim();
  const supportEmail = body.supportEmail?.trim().toLowerCase();

  if (!workspaceName || !supportEmail) {
    return NextResponse.json(
      { error: "Workspace name and support email are required." },
      { status: 400 },
    );
  }

  const [workspace, settings] = await prisma.$transaction([
    prisma.workspace.update({
      where: {
        id: session.user.workspaceId,
      },
      data: {
        name: workspaceName,
        supportEmail,
      },
    }),
    prisma.workspaceSetting.upsert({
      where: {
        workspaceId: session.user.workspaceId,
      },
      update: {
        timezone: body.timezone?.trim() || "Asia/Karachi",
        theme: body.theme?.trim() || "dark",
        supportSignature: body.supportSignature?.trim() || null,
        ...(typeof body.crossChannelMemory === "boolean"
          ? { crossChannelMemory: body.crossChannelMemory }
          : {}),
      },
      create: {
        workspaceId: session.user.workspaceId,
        timezone: body.timezone?.trim() || "Asia/Karachi",
        theme: body.theme?.trim() || "dark",
        supportSignature: body.supportSignature?.trim() || null,
        crossChannelMemory: body.crossChannelMemory !== false,
      },
    }),
  ]);

  return NextResponse.json({ workspace, settings });
}
