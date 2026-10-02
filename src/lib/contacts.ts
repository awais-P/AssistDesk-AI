import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Customer identity for the Unified Memory Buffer (Module 5 FE-2).
 *
 * Every channel knows the customer by a different identifier: the website widget by
 * an anonymous device id (and an email/phone once given), WhatsApp by the phone
 * number, Slack by the Slack user id, email by the address. A Contact joins them, so
 * a conversation started on one channel can continue on another.
 */

import {
  type ChannelKind,
  type ContactIdentity,
  hasAnyIdentifier,
  normalizeEmail,
  normalizeIdentity,
  normalizePhone,
} from "./identity";

export {
  type ChannelKind,
  type ContactIdentity,
  hasAnyIdentifier,
  normalizeEmail,
  normalizeIdentity,
  normalizePhone,
};
export { normalizeVisitorId, whatsappIdToPhone } from "./identity";

function identifierFilters(identity: ContactIdentity) {
  const filters: Prisma.ContactWhereInput[] = [];

  if (identity.email) filters.push({ email: identity.email });
  if (identity.phone) filters.push({ phone: identity.phone });
  if (identity.whatsappId) filters.push({ whatsappId: identity.whatsappId });
  if (identity.slackUserId) filters.push({ slackUserId: identity.slackUserId });
  if (identity.visitorId) filters.push({ visitorId: identity.visitorId });

  return filters;
}

async function recordContactEvent(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  contactId: string,
  type: string,
  detail: string,
  metadata?: Prisma.InputJsonValue,
) {
  await tx.sessionEvent.create({
    data: { workspaceId, contactId, type, detail, metadata },
  });
}

/**
 * Merges `sourceId` into `targetId`: sessions, tickets and events move over, missing
 * identifiers are copied, memories are combined, the source contact is deleted.
 */
export async function mergeContacts(workspaceId: string, targetId: string, sourceId: string) {
  if (targetId === sourceId) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const [target, source] = await Promise.all([
      tx.contact.findFirst({ where: { id: targetId, workspaceId } }),
      tx.contact.findFirst({ where: { id: sourceId, workspaceId } }),
    ]);

    if (!target || !source) {
      return;
    }

    await tx.chatSession.updateMany({ where: { contactId: source.id }, data: { contactId: target.id } });
    await tx.ticket.updateMany({ where: { contactId: source.id }, data: { contactId: target.id } });
    await tx.sessionEvent.updateMany({ where: { contactId: source.id }, data: { contactId: target.id } });
    await tx.contact.delete({ where: { id: source.id } });

    const memory = [target.memory, source.memory].filter(Boolean).join("\n");

    await tx.contact.update({
      where: { id: target.id },
      data: {
        name: target.name ?? source.name,
        email: target.email ?? source.email,
        phone: target.phone ?? source.phone,
        whatsappId: target.whatsappId ?? source.whatsappId,
        slackUserId: target.slackUserId ?? source.slackUserId,
        visitorId: target.visitorId ?? source.visitorId,
        memory: memory ? memory.slice(0, 2000) : null,
        firstSeenAt: target.firstSeenAt < source.firstSeenAt ? target.firstSeenAt : source.firstSeenAt,
        lastSeenAt: target.lastSeenAt > source.lastSeenAt ? target.lastSeenAt : source.lastSeenAt,
      },
    });

    await recordContactEvent(
      tx,
      workspaceId,
      target.id,
      "CONTACTS_MERGED",
      `Merged duplicate customer record (${[source.email, source.phone, source.slackUserId ? "Slack" : null, source.visitorId ? "web visitor" : null].filter(Boolean).join(", ") || "anonymous"}).`,
      { mergedContactId: source.id },
    );
  });
}

/**
 * Finds the customer by any known identifier, creating them if new and merging
 * records when a new identifier proves two contacts are the same person.
 */
export async function resolveContact(
  workspaceId: string,
  rawIdentity: ContactIdentity,
  channel: ChannelKind,
) {
  const identity = normalizeIdentity(rawIdentity);

  if (!hasAnyIdentifier(identity)) {
    return null;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const matches = await prisma.contact.findMany({
      where: { workspaceId, OR: identifierFilters(identity) },
      orderBy: { firstSeenAt: "asc" },
    });

    let contact = matches[0] ?? null;

    for (const duplicate of matches.slice(1)) {
      await mergeContacts(workspaceId, matches[0].id, duplicate.id);
    }

    try {
      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            workspaceId,
            name: identity.name,
            email: identity.email,
            phone: identity.phone,
            whatsappId: identity.whatsappId,
            slackUserId: identity.slackUserId,
            visitorId: identity.visitorId,
            lastChannel: channel,
          },
        });

        await prisma.sessionEvent.create({
          data: {
            workspaceId,
            contactId: contact.id,
            type: "CONTACT_CREATED",
            detail: `New customer first seen on ${channel.replace("_", " ").toLowerCase()}.`,
          },
        });

        return contact;
      }

      if (matches.length > 1) {
        contact = (await prisma.contact.findUnique({ where: { id: contact.id } })) ?? contact;
      }

      const newIdentifiers: Prisma.ContactUpdateInput = {};
      const linked: string[] = [];

      if (identity.email && !contact.email) {
        newIdentifiers.email = identity.email;
        linked.push("email");
      }

      if (identity.phone && !contact.phone) {
        newIdentifiers.phone = identity.phone;
        linked.push("phone");
      }

      if (identity.whatsappId && !contact.whatsappId) {
        newIdentifiers.whatsappId = identity.whatsappId;
        linked.push("WhatsApp");
      }

      if (identity.slackUserId && !contact.slackUserId) {
        newIdentifiers.slackUserId = identity.slackUserId;
        linked.push("Slack");
      }

      if (identity.visitorId && !contact.visitorId) {
        newIdentifiers.visitorId = identity.visitorId;
        linked.push("website visitor");
      }

      const channelChanged = contact.lastChannel !== channel;
      const updated = await prisma.contact.update({
        where: { id: contact.id },
        data: {
          ...newIdentifiers,
          name: contact.name ?? identity.name,
          lastSeenAt: new Date(),
          lastChannel: channel,
        },
      });

      if (linked.length > 0 || channelChanged) {
        await prisma.sessionEvent.create({
          data: {
            workspaceId,
            contactId: contact.id,
            type: "CHANNEL_LINKED",
            detail:
              linked.length > 0
                ? `Linked ${linked.join(", ")} to this customer on ${channel.replace("_", " ").toLowerCase()}.`
                : `Customer returned on ${channel.replace("_", " ").toLowerCase()}.`,
            metadata: { channel, previousChannel: contact.lastChannel, linked },
          },
        });
      }

      return updated;
    } catch (error) {
      // Another request created or linked the same identifier at the same moment:
      // look it up again instead of failing.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }

      throw error;
    }
  }

  return null;
}

/** Customer-facing label: name, else email, else phone, else "Visitor". */
export function describeContact(contact: {
  name: string | null;
  email: string | null;
  phone: string | null;
}) {
  return contact.name || contact.email || contact.phone || "Visitor";
}

/**
 * Links a ticket created by the team to the requester's Contact without counting it
 * as a customer visit (resolveContact would move lastSeenAt / lastChannel).
 */
export async function findOrCreateContactByEmail(
  workspaceId: string,
  rawEmail: string,
  name?: string | null,
) {
  const email = normalizeEmail(rawEmail);

  if (!email) {
    return null;
  }

  const existing = await prisma.contact.findUnique({
    where: { workspaceId_email: { workspaceId, email } },
  });

  if (existing) {
    return existing;
  }

  try {
    const contact = await prisma.contact.create({
      data: { workspaceId, email, name: name?.trim().slice(0, 120) || null, lastChannel: "EMAIL" },
    });

    await prisma.sessionEvent.create({
      data: {
        workspaceId,
        contactId: contact.id,
        type: "CONTACT_CREATED",
        detail: "Customer added from a ticket created by the team.",
      },
    });

    return contact;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.contact.findUnique({ where: { workspaceId_email: { workspaceId, email } } });
    }

    throw error;
  }
}
