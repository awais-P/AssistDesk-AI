import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createPasswordResetForUser,
  generatePasswordResetToken,
  resetPasswordWithToken,
  verifyPassword,
} from "@/src/lib/auth";
import { sendPasswordResetEmail } from "@/src/lib/mailer";
import { prisma } from "@/src/lib/prisma";

describe("UT-56 forgot password & reset password workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Generation & Expiration", () => {
    it("UT-56.01 generates secure 64-character hex password reset tokens", () => {
      const token = generatePasswordResetToken();
      expect(typeof token).toBe("string");
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("UT-56.02 generates unique tokens across invocations", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        tokens.add(generatePasswordResetToken());
      }
      expect(tokens.size).toBe(50);
    });
  });

  describe("Password Reset Email Link Formatting", () => {
    it("UT-56.03 generates the expected reset URL link with encoded token", async () => {
      const origUrl = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://app.assistdesk.ai";

      const origSmtp = process.env.ASSISTDESK_SMTP_HOST;
      delete process.env.ASSISTDESK_SMTP_HOST;

      const result = await sendPasswordResetEmail({
        email: "test@example.com",
        fullName: "Test User",
        resetToken: "reset-tok-xyz",
      });

      expect(result.resetUrl).toBe("https://app.assistdesk.ai/reset-password?token=reset-tok-xyz");
      expect(result.status).toBe("NOT_CONFIGURED");

      process.env.NEXT_PUBLIC_APP_URL = origUrl;
      if (origSmtp) process.env.ASSISTDESK_SMTP_HOST = origSmtp;
    });
  });

  describe("Password Reset Request (createPasswordResetForUser)", () => {
    it("UT-56.04 handles non-existent user without throwing", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null as any);

      const result = await createPasswordResetForUser("unknown@example.com");
      expect(result.success).toBe(false);
      expect(result.notFound).toBe(true);
    });

    it("UT-56.05 stores token and expiration when user exists", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_reset_1",
        email: "valid@example.com",
        fullName: "Valid User",
      } as any);

      const updateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);

      const result = await createPasswordResetForUser("valid@example.com");
      expect(result.success).toBe(true);
      expect(result.token).toHaveLength(64);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "usr_reset_1" },
        data: {
          passwordResetToken: result.token,
          passwordResetExpiresAt: result.expiresAt,
        },
      });
    });
  });

  describe("Reset Password Execution (resetPasswordWithToken)", () => {
    it("UT-56.06 rejects missing token or invalid password format", async () => {
      const noToken = await resetPasswordWithToken("", "ValidPass123");
      expect(noToken.success).toBe(false);
      expect(noToken.error).toMatch(/token is required/i);

      const shortPass = await resetPasswordWithToken("valid-token", "short1");
      expect(shortPass.success).toBe(false);
      expect(shortPass.error).toMatch(/at least 8 characters/i);
    });

    it("UT-56.07 rejects invalid or unknown token", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null as any);

      const result = await resetPasswordWithToken("unknown-token", "ValidPass123");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid or expired/i);
    });

    it("UT-56.08 rejects expired password reset token", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_expired",
        passwordResetExpiresAt: new Date(Date.now() - 60_000), // 1 minute ago
      } as any);

      const result = await resetPasswordWithToken("expired-token", "ValidPass123");
      expect(result.success).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.error).toMatch(/expired/i);
    });

    it("UT-56.09 hashes new password with bcrypt, clears token and revokes sessions", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_valid_target",
        email: "user@example.com",
        fullName: "Test User",
        passwordResetExpiresAt: new Date(Date.now() + 1800_000), // 30 min left
        emailVerified: new Date(),
      } as any);

      let updatedData: any = null;
      vi.spyOn(prisma.user, "update").mockImplementation(((args: any) => {
        updatedData = args.data;
        return Promise.resolve({ id: "usr_valid_target" });
      }) as any);

      const deleteSessionsSpy = vi.spyOn(prisma.session, "deleteMany").mockResolvedValue({ count: 2 } as any);

      const result = await resetPasswordWithToken("valid-token-123", "BrandNewPass2026");
      expect(result.success).toBe(true);
      expect(updatedData).not.toBeNull();
      expect(updatedData.passwordResetToken).toBeNull();
      expect(updatedData.passwordResetExpiresAt).toBeNull();
      expect(updatedData.mustChangePassword).toBe(false);
      expect(updatedData.passwordHash.startsWith("$2")).toBe(true);

      // Verify the new bcrypt hash can verify the new password
      const verification = await verifyPassword("BrandNewPass2026", updatedData.passwordHash);
      expect(verification.valid).toBe(true);

      // Verify old sessions were revoked
      expect(deleteSessionsSpy).toHaveBeenCalledWith({
        where: { userId: "usr_valid_target" },
      });
    });
  });

  describe("API Route Handlers", () => {
    it("UT-56.10 POST /api/auth/forgot-password validates email and responds safely", async () => {
      const { POST: forgotPost } = await import("@/app/api/auth/forgot-password/route");

      // Invalid email
      const invalidReq = new Request("http://localhost/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      const invalidRes = await forgotPost(invalidReq);
      expect(invalidRes.status).toBe(400);

      // Valid email
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_test",
        email: "registered@example.com",
        fullName: "Registered User",
      } as any);
      vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);

      const validReq = new Request("http://localhost/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "registered@example.com" }),
      });
      const validRes = await forgotPost(validReq);
      expect(validRes.status).toBe(200);
      const validBody = await validRes.json();
      expect(validBody.success).toBe(true);
      expect(validBody.message).toMatch(/password reset link has been sent/i);
    });

    it("UT-56.11 POST /api/auth/reset-password handles reset workflow", async () => {
      const { POST: resetPost } = await import("@/app/api/auth/reset-password/route");

      // Missing password
      const missingPassReq = new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "sample-token" }),
      });
      const missingPassRes = await resetPost(missingPassReq);
      expect(missingPassRes.status).toBe(400);

      // Valid reset
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_reset_api",
        email: "user@example.com",
        fullName: "User API",
        passwordResetExpiresAt: new Date(Date.now() + 1800_000),
      } as any);
      vi.spyOn(prisma.user, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.session, "deleteMany").mockResolvedValue({ count: 1 } as any);

      const successReq = new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "valid-api-token", password: "NewStrongPass2026" }),
      });
      const successRes = await resetPost(successReq);
      expect(successRes.status).toBe(200);
      const successBody = await successRes.json();
      expect(successBody.success).toBe(true);
    });
  });
});
