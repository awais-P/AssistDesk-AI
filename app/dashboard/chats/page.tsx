import { redirect } from "next/navigation";
import {
  ChatsWorkspace,
  type ChatAttachmentItem,
} from "@/src/components/dashboard/chats-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";

function readAttachments(value: unknown): ChatAttachmentItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const attachment = item as Record<string, unknown>;

    if (typeof attachment.url !== "string" || !attachment.url) {
      return [];
    }

    return [
      {
        url: attachment.url,
        name: typeof attachment.name === "string" ? attachment.name : "Attachment",
        mimeType:
          typeof attachment.mimeType === "string" ? attachment.mimeType : "",
        size: typeof attachment.size === "number" ? attachment.size : null,
      },
    ];
  });
}

export default async function ChatsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const chatSessions = await prisma.chatSession.findMany({
    where: {
      workspaceId: session.user.workspaceId,
    },
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      status: true,
      channel: true,
      startedAt: true,
      updatedAt: true,
      chatbot: {
        select: {
          name: true,
        },
      },
      integration: {
        select: {
          name: true,
          type: true,
        },
      },
      messages: {
        select: {
          id: true,
          sender: true,
          content: true,
          attachments: true,
          authorName: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 50,
  });

  return (
    <ChatsWorkspace
      initialSessions={chatSessions.map((sessionItem) => ({
        id: sessionItem.id,
        customerName: sessionItem.customerName,
        customerEmail: sessionItem.customerEmail,
        customerPhone: sessionItem.customerPhone,
        status: sessionItem.status,
        channel: sessionItem.channel,
        startedAt: sessionItem.startedAt.toISOString(),
        updatedAt: sessionItem.updatedAt.toISOString(),
        chatbotName: sessionItem.chatbot?.name ?? null,
        integrationName: sessionItem.integration?.name ?? null,
        integrationType: sessionItem.integration?.type ?? null,
        messages: sessionItem.messages
          .slice()
          .reverse()
          .map((message) => ({
            id: message.id,
            sender: message.sender,
            content: message.content,
            authorName: message.authorName,
            attachments: readAttachments(message.attachments),
            createdAt: message.createdAt.toISOString(),
          })),
      }))}
    />
  );
}
