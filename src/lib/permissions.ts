/**
 * Module 11 FE-3 / FE-4: the permission matrix. Each permission has the lowest built-in
 * role that has it; an admin-defined (custom) role starts from a base role and can add
 * or remove permissions. Pure data, safe to import in the browser.
 */

export type BaseRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";

const rank: Record<BaseRole, number> = { AGENT: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };

export type PermissionKey =
  | "tickets.handle"
  | "escalations.assign"
  | "data.export"
  | "knowledge.manage"
  | "escalations.settings"
  | "audit.view"
  | "apikeys.manage"
  | "connectors.manage"
  | "roles.manage";

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  description: string;
  group: "Support" | "Data" | "AI & knowledge" | "Administration";
  minRole: BaseRole;
};

export const PERMISSIONS: PermissionDefinition[] = [
  { key: "tickets.handle", label: "Handle tickets, chats and escalations", description: "Reply to customers, accept and resolve their own escalations.", group: "Support", minRole: "AGENT" },
  { key: "escalations.assign", label: "Assign and take over escalations", description: "Give an escalation to a team member or take it from a colleague.", group: "Support", minRole: "MANAGER" },
  { key: "data.export", label: "Export data", description: "Download leads, analytics, escalations and the audit log as CSV.", group: "Data", minRole: "MANAGER" },
  { key: "knowledge.manage", label: "Manage the knowledge base", description: "Add, edit, re-index and delete knowledge sources.", group: "AI & knowledge", minRole: "MANAGER" },
  { key: "escalations.settings", label: "Change escalation rules", description: "Triggers, sentiment threshold, trigger phrases and response time.", group: "Administration", minRole: "ADMIN" },
  { key: "audit.view", label: "View the security & audit log", description: "Sign-ins, role changes, settings, API and data access.", group: "Administration", minRole: "ADMIN" },
  { key: "apikeys.manage", label: "Manage API keys", description: "Create and revoke keys for the public API.", group: "Administration", minRole: "ADMIN" },
  { key: "connectors.manage", label: "Manage connectors", description: "Connect HubSpot and Shopify.", group: "Administration", minRole: "ADMIN" },
  { key: "roles.manage", label: "Manage custom roles", description: "Create roles and give them to team members.", group: "Administration", minRole: "ADMIN" },
];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);
export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((permission) => [permission.key, permission]));

/** Permissions that a custom role can never be given below Admin. */
export const ADMIN_ONLY_PERMISSIONS: PermissionKey[] = ["roles.manage", "apikeys.manage"];

export type PermissionSubject = {
  role: string;
  customRole?: { permissions: string[]; deniedPermissions: string[] } | null;
};

export function roleHas(role: string, key: PermissionKey) {
  const definition = PERMISSION_BY_KEY.get(key);
  return Boolean(definition && (rank[role as BaseRole] ?? 0) >= rank[definition.minRole]);
}

/** Whether the user has the permission, after their custom role's additions and removals. */
export function can(user: PermissionSubject, key: PermissionKey) {
  // The owner always keeps every permission, so a workspace can't lock itself out.
  if (user.role === "OWNER") return true;
  const custom = user.customRole;
  if (custom?.deniedPermissions.includes(key)) return false;
  if (custom?.permissions.includes(key)) return true;
  return roleHas(user.role, key);
}

export function effectivePermissions(user: PermissionSubject) {
  return PERMISSION_KEYS.filter((key) => can(user, key));
}

/** Validates a custom role's lists against its base role. */
export function validateCustomRole(input: { baseRole: string; permissions: string[]; deniedPermissions: string[] }) {
  if (!["ADMIN", "MANAGER", "AGENT"].includes(input.baseRole)) {
    return "The base role must be Admin, Manager or Agent.";
  }
  const unknown = [...input.permissions, ...input.deniedPermissions].filter((key) => !PERMISSION_KEYS.includes(key as PermissionKey));
  if (unknown.length > 0) {
    return `Unknown permission: ${unknown.join(", ")}`;
  }
  if (input.permissions.some((key) => input.deniedPermissions.includes(key))) {
    return "A permission cannot be both added and removed.";
  }
  if (input.baseRole !== "ADMIN" && input.permissions.some((key) => ADMIN_ONLY_PERMISSIONS.includes(key as PermissionKey))) {
    return "Managing roles and API keys stays with admins.";
  }
  return null;
}
