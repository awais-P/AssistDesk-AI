import { prisma } from "./prisma";

export type NotificationSeverityValue = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

type CreateNotificationInput = {
  workspaceId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: NotificationSeverityValue;
  /** Skip if the same type + title was already raised within this many minutes. */
  dedupeMinutes?: number;
};

/**
 * Raises a dashboard alert (Module 7 FE-3). Failures are logged and swallowed so an
 * alert can never break the action that triggered it.
 */
export async function createNotification({
  workspaceId,
  type,
  title,
  body = null,
  link = null,
  severity = "INFO",
  dedupeMinutes,
}: CreateNotificationInput) {
  try {
    if (dedupeMinutes) {
      const recent = await prisma.notification.findFirst({
        where: {
          workspaceId,
          type,
          title,
          createdAt: { gte: new Date(Date.now() - dedupeMinutes * 60 * 1000) },
        },
        select: { id: true },
      });

      if (recent) {
        return null;
      }
    }

    return await prisma.notification.create({
      data: {
        workspaceId,
        type,
        severity,
        title: title.slice(0, 160),
        body: body?.slice(0, 500) ?? null,
        link,
      },
    });
  } catch (error) {
    console.error("[notifications] Failed to create notification:", error);
    return null;
  }
}

export async function listNotifications(workspaceId: string, userId: string, take = 30) {
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take,
    }),
    prisma.notification.count({
      where: { workspaceId, NOT: { readBy: { has: userId } } },
    }),
  ]);

  return {
    unreadCount,
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      createdAt: notification.createdAt.toISOString(),
      read: notification.readBy.includes(userId),
    })),
  };
}

export async function markNotificationsRead(
  workspaceId: string,
  userId: string,
  ids: string[] | "all",
) {
  const unread = await prisma.notification.findMany({
    where: {
      workspaceId,
      NOT: { readBy: { has: userId } },
      ...(ids === "all" ? {} : { id: { in: ids } }),
    },
    select: { id: true },
  });

  await Promise.all(
    unread.map((notification) =>
      prisma.notification.update({
        where: { id: notification.id },
        data: { readBy: { push: userId } },
        select: { id: true },
      }),
    ),
  );

  return unread.length;
}
