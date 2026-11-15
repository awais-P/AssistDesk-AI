import { NextResponse } from "next/server";
import { auditUser, trackAudit } from "./audit";
import { PERMISSION_BY_KEY, type PermissionKey, type PermissionSubject, can } from "./permissions";

/**
 * Server-side permission checks (Module 11 FE-3/FE-4). Refused attempts are written to
 * the audit log (SRS: unauthorized attempts are logged), both here and for the older
 * role checks in rbac.ts through the hook installed below.
 */

type AccessUser = PermissionSubject & { id: string; workspaceId: string; fullName?: string | null };

export function requirePermission(user: AccessUser, key: PermissionKey, request?: Request | null) {
  if (can(user, key)) {
    return null;
  }

  const definition = PERMISSION_BY_KEY.get(key);
  trackAudit(
    auditUser(user, {
      action: "access.denied",
      category: "access",
      outcome: "DENIED",
      summary: `Refused: ${definition?.label ?? key}`,
      metadata: { permission: key, role: user.role, path: request ? new URL(request.url).pathname : null },
      request,
    }),
  );

  return NextResponse.json(
    { error: `You don't have permission to ${definition?.label.toLowerCase() ?? key}. Ask a workspace admin for access.` },
    { status: 403 },
  );
}

declare global {
  var assistdeskOnRoleDenied: ((user: { role: string }, minimum: string) => void) | undefined;
}

/** rbac.ts stays browser-safe, so it reports refusals through this hook. */
export function installRoleDenialAudit() {
  globalThis.assistdeskOnRoleDenied = (user, minimum) => {
    const candidate = user as Partial<AccessUser>;
    if (!candidate.id || !candidate.workspaceId) return;
    trackAudit(
      auditUser(candidate as AccessUser, {
        action: "access.denied",
        category: "access",
        outcome: "DENIED",
        summary: `Refused: needs the ${minimum.charAt(0)}${minimum.slice(1).toLowerCase()} role (has ${user.role.toLowerCase()})`,
        metadata: { needed: minimum, role: user.role },
      }),
    );
  };
}

installRoleDenialAudit();
