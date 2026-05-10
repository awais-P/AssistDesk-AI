import { redirect } from "next/navigation";
import { TagsWorkspace } from "@/src/components/dashboard/tags-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { ensureDemoData } from "@/src/lib/demo-data";
import { prisma } from "@/src/lib/prisma";

export default async function TagsPage() {
  const [, session] = await Promise.all([ensureDemoData(), getCurrentSession()]);

  if (!session) {
    redirect("/login");
  }

  const tags = await prisma.tag.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return (
    <TagsWorkspace
      initialTags={tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      }))}
    />
  );
}
