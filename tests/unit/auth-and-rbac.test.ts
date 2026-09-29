import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  validateNewPassword,
  verifyPassword,
} from "@/src/lib/auth";
import { canAssignRole, canManageMember, hasRole } from "@/src/lib/rbac";

describe("password hashing", () => {
  it("uses bcrypt and verifies correct passwords only", async () => {
    const hash = await hashPassword("Secret123");

    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword("Secret123", hash)).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(verifyPassword("secret123", hash)).resolves.toMatchObject({ valid: false });
  }, 20_000);

  it("accepts legacy SHA-256 hashes once and asks for a re-hash", async () => {
    const legacy = createHash("sha256").update("oldpass1").digest("hex");

    await expect(verifyPassword("oldpass1", legacy)).resolves.toEqual({ valid: true, needsRehash: true });
    await expect(verifyPassword("wrong", legacy)).resolves.toMatchObject({ valid: false });
  });

  it("never treats the stored hash itself as a valid password (SEC-01)", async () => {
    const legacy = createHash("sha256").update("oldpass1").digest("hex");
    const bcryptHash = await hashPassword("Secret123");

    await expect(verifyPassword(legacy, legacy)).resolves.toMatchObject({ valid: false });
    await expect(verifyPassword(bcryptHash, bcryptHash)).resolves.toMatchObject({ valid: false });
    await expect(verifyPassword("plain", "plain")).resolves.toMatchObject({ valid: false });
    await expect(verifyPassword("x", null)).resolves.toMatchObject({ valid: false });
  }, 20_000);

  it("enforces password rules and email format", () => {
    expect(validateNewPassword("abc")).toMatch(/at least 8/);
    expect(validateNewPassword("abcdefgh")).toMatch(/letter and one number/);
    expect(validateNewPassword("abcdefg1")).toBeNull();
    expect(isValidEmail("name@company.com")).toBe(true);
    expect(isValidEmail("admin")).toBe(false);
  });

  it("generates strong temporary passwords that pass the rules", () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(20);
    expect(validateNewPassword(first)).toBeNull();
  });

  it("stores sessions as hashes, not tokens", () => {
    expect(hashSessionToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashSessionToken("abc")).not.toBe("abc");
  });
});

describe("role-based access control", () => {
  const owner = { id: "o", role: "OWNER" };
  const admin = { id: "a", role: "ADMIN" };
  const otherAdmin = { id: "a2", role: "ADMIN" };
  const manager = { id: "m", role: "MANAGER" };
  const agent = { id: "g", role: "AGENT" };

  it("ranks roles", () => {
    expect(hasRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRole("MANAGER", "ADMIN")).toBe(false);
    expect(hasRole("AGENT", "AGENT")).toBe(true);
    expect(hasRole("NONSENSE", "AGENT")).toBe(false);
  });

  it("stops privilege escalation (SEC-04)", () => {
    expect(canManageMember(agent, agent)).toBe(false);
    expect(canManageMember(admin, owner)).toBe(false);
    expect(canManageMember(admin, otherAdmin)).toBe(false);
    expect(canManageMember(manager, agent)).toBe(false);
    expect(canManageMember(admin, manager)).toBe(true);
    expect(canManageMember(owner, admin)).toBe(true);
  });

  it("limits which roles can be assigned", () => {
    expect(canAssignRole(admin, "OWNER")).toBe(false);
    expect(canAssignRole(admin, "ADMIN")).toBe(false);
    expect(canAssignRole(admin, "MANAGER")).toBe(true);
    expect(canAssignRole(owner, "ADMIN")).toBe(true);
    expect(canAssignRole(owner, "OWNER")).toBe(false);
  });
});
