import { NextResponse } from "next/server";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

type SettingsPayload = {
  workspaceName?: string;
  supportEmail?: string;
  timezone?: string;
  theme?: string;
  supportSignature?: string;
};

export async function PATCH(request: Request) {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
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
      },
      create: {
        workspaceId: session.user.workspaceId,
        timezone: body.timezone?.trim() || "Asia/Karachi",
        theme: body.theme?.trim() || "dark",
        supportSignature: body.supportSignature?.trim() || null,
      },
    }),
  ]);

  return NextResponse.json({ workspace, settings });
}
