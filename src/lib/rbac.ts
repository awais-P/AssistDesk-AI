import { NextResponse } from "next/server";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";

const roleRank: Record<WorkspaceRole, number> = {
  AGENT: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export const assignableRoles: WorkspaceRole[] = ["ADMIN", "MANAGER", "AGENT"];

export const roleDescriptions: Record<WorkspaceRole, string> = {
  OWNER: "Full access, including billing and deleting the workspace.",
  ADMIN: "Manage team members, settings, integrations, inboxes and AI.",
  MANAGER: "Manage AI agents, chatbots, knowledge base, prompts and reports.",
  AGENT: "Handle tickets and chats, use canned responses and AI drafts.",
};

export function hasRole(role: string, minimum: WorkspaceRole) {
  return (roleRank[role as WorkspaceRole] ?? 0) >= roleRank[minimum];
}

/**
 * Returns a 403 response when the signed-in user's role is below `minimum`,
 * otherwise null (SRS SEC-2, Module 11 FE-3/FE-4).
 */
export function requireRole(user: { role: string }, minimum: WorkspaceRole) {
  if (hasRole(user.role, minimum)) {
    return null;
  }

  return NextResponse.json(
    {
      error: `This action needs the ${minimum.charAt(0)}${minimum.slice(1).toLowerCase()} role or higher. Ask a workspace admin for access.`,
    },
    { status: 403 },
  );
}

/**
 * Whether `actor` may change `target`'s role or status: nobody can change the owner
 * or themselves, and nobody can act on someone with an equal or higher role
 * (except the owner, who can manage admins).
 */
export function canManageMember(
  actor: { id: string; role: string },
  target: { id: string; role: string },
) {
  if (actor.id === target.id || target.role === "OWNER") {
    return false;
  }

  if (actor.role === "OWNER") {
    return true;
  }

  return hasRole(actor.role, "ADMIN") && roleRank[target.role as WorkspaceRole] < roleRank[actor.role as WorkspaceRole];
}

export function canAssignRole(actor: { role: string }, role: string) {
  if (!assignableRoles.includes(role as WorkspaceRole)) {
    return false;
  }

  return actor.role === "OWNER" || roleRank[role as WorkspaceRole] < roleRank[actor.role as WorkspaceRole];
}
