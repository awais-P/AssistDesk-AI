import { redirect } from "next/navigation";
import { UsersWorkspace } from "@/src/components/dashboard/users-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

export default async function UsersPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [users, sessions] = await Promise.all([
    prisma.user.findMany({
      where: {
        workspaceId: session.user.workspaceId,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 100,
    }),
    prisma.session.findMany({
      where: {
        user: {
          workspaceId: session.user.workspaceId,
        },
      },
      select: {
        userId: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
  ]);

  const lastLoginMap = new Map<string, string>();

  for (const item of sessions) {
    if (!lastLoginMap.has(item.userId)) {
      lastLoginMap.set(item.userId, item.updatedAt.toISOString());
    }
  }

  return (
    <UsersWorkspace
      initialUsers={users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: lastLoginMap.get(user.id) ?? null,
      }))}
      currentUserId={session.user.id}
    />
  );
}
