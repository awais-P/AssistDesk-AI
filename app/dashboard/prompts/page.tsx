import { redirect } from "next/navigation";
import { PromptsWorkspace } from "@/src/components/dashboard/prompts-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { defaultPromptTemplates } from "@/src/lib/prompt-templates";
import { hasRole } from "@/src/lib/rbac";

export default async function PromptsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const workspaceId = session.user.workspaceId;
  const existingCount = await prisma.promptTemplate.count({ where: { workspaceId } });

  // A new workspace starts with a few useful prompts (same as GET /api/prompts).
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
    select: {
      id: true,
      name: true,
      body: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <PromptsWorkspace
      initialPrompts={prompts.map((prompt) => ({
        id: prompt.id,
        name: prompt.name,
        body: prompt.body,
        createdAt: prompt.createdAt.toISOString(),
        updatedAt: prompt.updatedAt.toISOString(),
      }))}
      canEdit={hasRole(session.user.role, "MANAGER")}
    />
  );
}
