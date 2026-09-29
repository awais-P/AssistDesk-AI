import { redirect } from "next/navigation";
import { UsersWorkspace } from "@/src/components/dashboard/users-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { PRESENCE_WINDOW_MS } from "@/src/lib/presence";
import { prisma } from "@/src/lib/prisma";
import {
  assignableRoles,
  canAssignRole,
  canManageMember,
  hasRole,
  roleDescriptions,
} from "@/src/lib/rbac";

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
        mustChangePassword: true,
        lastSeenAt: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 500,
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

  const lastLoginMap = new Map<string, Date>();

  for (const item of sessions) {
    if (!lastLoginMap.has(item.userId)) {
      lastLoginMap.set(item.userId, item.updatedAt);
    }
  }

  const actor = { id: session.user.id, role: session.user.role };
  // Only admins and the owner can invite or change members (enforced again by the API).
  const canManageTeam = hasRole(actor.role, "ADMIN");
  const actorAssignableRoles = canManageTeam
    ? assignableRoles.filter((role) => canAssignRole(actor, role))
    : [];

  return (
    <UsersWorkspace
      users={users.map((user) => {
        const canManage = canManageTeam && canManageMember(actor, user);

        return {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          mustChangePassword: user.mustChangePassword,
          createdAt: user.createdAt.toISOString(),
          lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
          lastLoginAt: lastLoginMap.get(user.id)?.toISOString() ?? null,
          canManage,
          assignableRoles: canManage
            ? actorAssignableRoles.filter((role) => role !== user.role)
            : [],
        };
      })}
      currentUserId={session.user.id}
      canManageTeam={canManageTeam}
      invitableRoles={actorAssignableRoles.map((role) => ({
        value: role,
        description: roleDescriptions[role],
      }))}
      presenceWindowMs={PRESENCE_WINDOW_MS}
    />
  );
}
