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

describe("UT-01 password hashing", () => {
  it("creates bcrypt password hashes", async () => {
    const hash = await hashPassword("Secret123");

    expect(hash.startsWith("$2")).toBe(true);
  }, 20_000);

  it("verifies correct passwords only", async () => {
    const hash = await hashPassword("Secret123");

    await expect(verifyPassword("Secret123", hash)).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(verifyPassword("secret123", hash)).resolves.toMatchObject({ valid: false });
  }, 20_000);

  it("accepts a correct legacy SHA-256 password once", async () => {
    const legacy = createHash("sha256").update("oldpass1").digest("hex");

    await expect(verifyPassword("oldpass1", legacy)).resolves.toEqual({ valid: true, needsRehash: true });
  });

  it("rejects an incorrect legacy SHA-256 password", async () => {
    const legacy = createHash("sha256").update("oldpass1").digest("hex");

    await expect(verifyPassword("wrong", legacy)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a legacy hash used as the password - SEC-01", async () => {
    const legacy = createHash("sha256").update("oldpass1").digest("hex");

    await expect(verifyPassword(legacy, legacy)).resolves.toMatchObject({ valid: false });
  });

  it("rejects a bcrypt hash used as the password - SEC-01", async () => {
    const bcryptHash = await hashPassword("Secret123");

    await expect(verifyPassword(bcryptHash, bcryptHash)).resolves.toMatchObject({ valid: false });
  }, 20_000);

  it("rejects plaintext and missing password hashes - SEC-01", async () => {
    await expect(verifyPassword("plain", "plain")).resolves.toMatchObject({ valid: false });
    await expect(verifyPassword("x", null)).resolves.toMatchObject({ valid: false });
  });

  it("rejects short passwords", () => {
    expect(validateNewPassword("abc")).toMatch(/at least 8/);
  });

  it("rejects passwords without a number", () => {
    expect(validateNewPassword("abcdefgh")).toMatch(/letter and one number/);
  });

  it("accepts valid passwords", () => {
    expect(validateNewPassword("abcdefg1")).toBeNull();
  });

  it("accepts valid email addresses", () => {
    expect(isValidEmail("name@company.com")).toBe(true);
  });

  it("rejects invalid email addresses", () => {
    expect(isValidEmail("admin")).toBe(false);
  });

  it("generates different temporary passwords", () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();

    expect(first).not.toBe(second);
  });

  it("generates temporary passwords with sufficient length", () => {
    const first = generateTemporaryPassword();

    expect(first.length).toBeGreaterThanOrEqual(20);
  });

  it("generates temporary passwords that pass validation", () => {
    const first = generateTemporaryPassword();

    expect(validateNewPassword(first)).toBeNull();
  });

  it("stores sessions as hashes, not tokens", () => {
    expect(hashSessionToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashSessionToken("abc")).not.toBe("abc");
  });
});

describe("UT-02 role-based access control", () => {
  const owner = { id: "o", role: "OWNER" };
  const admin = { id: "a", role: "ADMIN" };
  const otherAdmin = { id: "a2", role: "ADMIN" };
  const manager = { id: "m", role: "MANAGER" };
  const agent = { id: "g", role: "AGENT" };

  it("recognises owner access to admin actions", () => {
    expect(hasRole("OWNER", "ADMIN")).toBe(true);
  });

  it("rejects manager access to admin actions", () => {
    expect(hasRole("MANAGER", "ADMIN")).toBe(false);
  });

  it("recognises an agent's own role", () => {
    expect(hasRole("AGENT", "AGENT")).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(hasRole("NONSENSE", "AGENT")).toBe(false);
  });

  it("prevents agents from managing members - SEC-04", () => {
    expect(canManageMember(agent, agent)).toBe(false);
  });

  it("prevents admins from managing owners - SEC-04", () => {
    expect(canManageMember(admin, owner)).toBe(false);
  });

  it("prevents admins from managing other admins - SEC-04", () => {
    expect(canManageMember(admin, otherAdmin)).toBe(false);
  });

  it("prevents managers from managing agents - SEC-04", () => {
    expect(canManageMember(manager, agent)).toBe(false);
  });

  it("allows admins to manage managers - SEC-04", () => {
    expect(canManageMember(admin, manager)).toBe(true);
  });

  it("allows owners to manage admins - SEC-04", () => {
    expect(canManageMember(owner, admin)).toBe(true);
  });

  it("prevents admins from assigning owner roles", () => {
    expect(canAssignRole(admin, "OWNER")).toBe(false);
  });

  it("prevents admins from assigning admin roles", () => {
    expect(canAssignRole(admin, "ADMIN")).toBe(false);
  });

  it("allows admins to assign manager roles", () => {
    expect(canAssignRole(admin, "MANAGER")).toBe(true);
  });

  it("allows owners to assign admin roles", () => {
    expect(canAssignRole(owner, "ADMIN")).toBe(true);
  });

  it("prevents owners from assigning owner roles", () => {
    expect(canAssignRole(owner, "OWNER")).toBe(false);
  });
});
