import { validateCustomRole } from "./permissions";

/** Module 11 FE-4: validation of the custom-role form. */
export function parseCustomRoleInput(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 200) || null : null;
  const baseRole = typeof body.baseRole === "string" ? body.baseRole : "";
  const list = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : []);
  const permissions = list(body.permissions);
  const deniedPermissions = list(body.deniedPermissions);

  if (name.length < 2 || name.length > 40) {
    return { error: "Give the role a name of 2 to 40 characters, e.g. \"Senior agent\"." } as const;
  }

  if (["owner", "admin", "manager", "agent"].includes(name.toLowerCase())) {
    return { error: "That name is a built-in role. Choose another name." } as const;
  }

  const invalid = validateCustomRole({ baseRole, permissions, deniedPermissions });

  if (invalid) {
    return { error: invalid } as const;
  }

  return { value: { name, description, baseRole: baseRole as "ADMIN" | "MANAGER" | "AGENT", permissions, deniedPermissions } } as const;
}
