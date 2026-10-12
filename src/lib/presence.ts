import { prisma } from "./prisma";

/** A team member counts as online if the dashboard pinged within this window. */
export const PRESENCE_WINDOW_MS = 2 * 60 * 1000;

export async function touchUserPresence(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeenAt: new Date() },
    select: { id: true },
  });
}

export async function countOnlineOperators(workspaceId: string) {
  return prisma.user.count({
    where: {
      workspaceId,
      isActive: true,
      lastSeenAt: {
        gte: new Date(Date.now() - PRESENCE_WINDOW_MS),
      },
    },
  });
}

export async function isWorkspaceOnline(workspaceId: string) {
  return (await countOnlineOperators(workspaceId)) > 0;
}
