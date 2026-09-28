import { redirect } from "next/navigation";
import { TagsWorkspace } from "@/src/components/dashboard/tags-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function TagsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const tags = await prisma.tag.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      name: true,
      color: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 500,
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
