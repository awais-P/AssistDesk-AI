import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateEmailVerificationToken,
  verifyEmailToken,
} from "@/src/lib/auth";
import { sendVerificationEmail } from "@/src/lib/mailer";
import { prisma } from "@/src/lib/prisma";

describe("UT-55 email verification on signup & login restrictions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Generation", () => {
    it("UT-55.01 generates secure 64-character hex verification tokens", () => {
      const token = generateEmailVerificationToken();
      expect(typeof token).toBe("string");
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("UT-55.02 generates unique tokens on successive invocations", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        tokens.add(generateEmailVerificationToken());
      }
      expect(tokens.size).toBe(50);
    });
  });

  describe("Token Verification Logic", () => {
    it("UT-55.03 rejects missing or empty verification tokens", async () => {
      const emptyResult = await verifyEmailToken("");
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error).toMatch(/required/i);

      // @ts-expect-error testing invalid type
      const nullResult = await verifyEmailToken(null);
      expect(nullResult.success).toBe(false);
      expect(nullResult.error).toMatch(/required/i);
    });

    it("UT-55.04 rejects an invalid or unknown verification token", async () => {
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null as any);

      const result = await verifyEmailToken("nonexistent-token-1234567890abcdef1234567890abcdef");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid or expired/i);
    });

    it("UT-55.05 rejects an expired verification token and flags expiration", async () => {
      const expiredUser = {
        id: "usr_expired_1",
        email: "user@example.com",
        emailVerificationToken: "expired-token",
        emailVerificationExpiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
      };

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(expiredUser as any);

      const result = await verifyEmailToken("expired-token");
      expect(result.success).toBe(false);
      expect(result.expired).toBe(true);
      expect(result.error).toMatch(/expired/i);
    });

    it("UT-55.06 verifies a valid token, updates user record, and clears token", async () => {
      const validUser = {
        id: "usr_valid_1",
        email: "valid@example.com",
        isEmailVerified: false,
        emailVerificationToken: "valid-token-123",
        emailVerificationExpiresAt: new Date(Date.now() + 86400_000), // 24 hours later
      };

      const updatedUser = {
        ...validUser,
        isEmailVerified: true,
        emailVerified: new Date(),
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
      };

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(validUser as any);
      const updateSpy = vi.spyOn(prisma.user, "update").mockResolvedValue(updatedUser as any);

      const result = await verifyEmailToken("valid-token-123");
      expect(result.success).toBe(true);
      expect(result.user?.isEmailVerified).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "usr_valid_1" },
        data: expect.objectContaining({
          isEmailVerified: true,
          emailVerified: expect.any(Date),
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
        }),
      });
    });
  });

  describe("Verification Email Delivery", () => {
    it("UT-55.07 generates the expected verification URL link", async () => {
      const origUrl = process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXT_PUBLIC_APP_URL = "https://app.assistdesk.ai";

      const origSmtp = process.env.ASSISTDESK_SMTP_HOST;
      delete process.env.ASSISTDESK_SMTP_HOST;

      const result = await sendVerificationEmail({
        email: "test@example.com",
        fullName: "Test User",
        verificationToken: "sample-token-abc-123",
      });

      expect(result.verifyUrl).toBe("https://app.assistdesk.ai/verify-email?token=sample-token-abc-123");
      expect(result.status).toBe("NOT_CONFIGURED");

      process.env.NEXT_PUBLIC_APP_URL = origUrl;
      if (origSmtp) process.env.ASSISTDESK_SMTP_HOST = origSmtp;
    });

    it("UT-55.08 gracefully handles missing SMTP without throwing an error", async () => {
      const origSmtp = process.env.ASSISTDESK_SMTP_HOST;
      delete process.env.ASSISTDESK_SMTP_HOST;

      await expect(
        sendVerificationEmail({
          email: "test@example.com",
          fullName: "Tester",
          verificationToken: "tok123",
        }),
      ).resolves.toMatchObject({
        status: "NOT_CONFIGURED",
        error: expect.stringMatching(/no platform smtp/i),
      });

      if (origSmtp) process.env.ASSISTDESK_SMTP_HOST = origSmtp;
    });
  });

  describe("Login Guard & API Integration", () => {
    it("UT-55.09 prevents unverified user from logging in via POST /api/auth/login", async () => {
      const { POST: loginPost } = await import("@/app/api/auth/login/route");
      const { hashPassword } = await import("@/src/lib/auth");

      const hashedPassword = await hashPassword("ValidPassword123");

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_unverified",
        email: "unverified@example.com",
        username: "unverified",
        passwordHash: hashedPassword,
        isActive: true,
        isEmailVerified: false,
        emailVerified: null,
        workspaceId: "ws_1",
      } as any);

      const request = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "unverified@example.com",
          password: "ValidPassword123",
        }),
      });

      const response = await loginPost(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.unverified).toBe(true);
      expect(body.error).toMatch(/email is not verified/i);
    });

    it("UT-55.10 allows verified user to log in via POST /api/auth/login", async () => {
      const { POST: loginPost } = await import("@/app/api/auth/login/route");
      const { hashPassword } = await import("@/src/lib/auth");

      const hashedPassword = await hashPassword("ValidPassword123");

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_verified",
        email: "verified@example.com",
        username: "verified",
        passwordHash: hashedPassword,
        isActive: true,
        isEmailVerified: true,
        emailVerified: new Date(),
        workspaceId: "ws_1",
      } as any);

      vi.spyOn(prisma.session, "create").mockResolvedValue({
        id: "sess_1",
        token: "tok",
        userId: "usr_verified",
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValue({
        id: "ws_1",
        inboxes: [{ id: "inbox_1" }],
        agents: [{ id: "agent_1" }],
        knowledgeSources: [{ id: "ks_1" }],
        chatbots: [{ id: "cb_1" }],
      } as any);

      vi.spyOn(prisma.rateLimitBucket, "deleteMany").mockResolvedValue({ count: 1 } as any);

      const request = new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "verified@example.com",
          password: "ValidPassword123",
        }),
      });

      const response = await loginPost(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it("UT-55.11 verification endpoint verifies token and returns 200 with setup redirect", async () => {
      const { GET: verifyGet, POST: verifyPost } = await import("@/app/api/auth/verify/route");

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue({
        id: "usr_to_verify",
        email: "toverify@example.com",
        emailVerificationToken: "test-token-xyz",
        emailVerificationExpiresAt: new Date(Date.now() + 86400000),
      } as any);

      vi.spyOn(prisma.user, "update").mockResolvedValue({
        id: "usr_to_verify",
        email: "toverify@example.com",
        isEmailVerified: true,
        emailVerified: new Date(),
      } as any);

      vi.spyOn(prisma.session, "create").mockResolvedValue({
        id: "sess_v",
        token: "session_tok",
        userId: "usr_to_verify",
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      // GET query test
      const getReq = new Request("http://localhost/api/auth/verify?token=test-token-xyz", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const getRes = await verifyGet(getReq);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.success).toBe(true);
      expect(getBody.redirectTo).toBe("/setup");

      // POST body test
      const postReq = new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "test-token-xyz" }),
      });
      const postRes = await verifyPost(postReq);
      expect(postRes.status).toBe(200);
      const postBody = await postRes.json();
      expect(postBody.success).toBe(true);
      expect(postBody.redirectTo).toBe("/setup");
    });

    it("UT-55.12 resend-verification handles already verified and unverified users", async () => {
      const { POST: resendPost } = await import("@/app/api/auth/resend-verification/route");

      // Invalid email
      const badReq = new Request("http://localhost/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invalid-email" }),
      });
      const badRes = await resendPost(badReq);
      expect(badRes.status).toBe(400);

      // Already verified
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        id: "usr_done",
        email: "done@example.com",
        fullName: "Done User",
        isEmailVerified: true,
        emailVerified: new Date(),
      } as any);

      const verifiedReq = new Request("http://localhost/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "done@example.com" }),
      });
      const verifiedRes = await resendPost(verifiedReq);
      expect(verifiedRes.status).toBe(200);
      const verifiedBody = await verifiedRes.json();
      expect(verifiedBody.alreadyVerified).toBe(true);

      // Unverified user triggers update and email resend
      vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce({
        id: "usr_need_resend",
        email: "need@example.com",
        fullName: "Need User",
        isEmailVerified: false,
        emailVerified: null,
      } as any);

      vi.spyOn(prisma.user, "update").mockResolvedValueOnce({
        id: "usr_need_resend",
        email: "need@example.com",
        fullName: "Need User",
        emailVerificationToken: "new-token-123",
        emailVerificationExpiresAt: new Date(Date.now() + 86400000),
      } as any);

      const unverifiedReq = new Request("http://localhost/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "need@example.com" }),
      });
      const unverifiedRes = await resendPost(unverifiedReq);
      expect(unverifiedRes.status).toBe(200);
      const unverifiedBody = await unverifiedRes.json();
      expect(unverifiedBody.success).toBe(true);
    });

    it("UT-55.13 signup logs in user and redirects directly to /setup for AI agent onboarding", async () => {
      const { POST: signupPost } = await import("@/app/api/auth/signup/route");

      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null as any);
      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValue(null as any);
      vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null as any);

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          workspace: {
            create: vi.fn().mockResolvedValue({ id: "ws_signup" }),
          },
          user: {
            create: vi.fn().mockResolvedValue({ id: "usr_new", email: "newuser@example.com" }),
          },
        });
      });

      vi.spyOn(prisma.session, "create").mockResolvedValue({
        id: "sess_new",
        token: "session_tok",
        userId: "usr_new",
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const request = new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "New Customer",
          email: "newcustomer@example.com",
          password: "SecurePassword123",
        }),
      });

      const response = await signupPost(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.redirectTo).toBe("/setup");
      expect(response.headers.get("set-cookie")).toContain("assistdesk_session=");
    });
  });
});
