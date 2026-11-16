import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPlatformEmailConfigured,
  sendPasswordResetEmail,
  sendTeamEmail,
  sendVerificationEmail,
} from "@/src/lib/mailer";

const FAKE_KEY = "fake-brevo-key-for-tests";

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("UT-65 platform email over HTTPS (Brevo) - hosts that block SMTP", () => {
  it("UT-65.01 with BREVO_API_KEY set, the verification email goes to Brevo's API, not SMTP", async () => {
    vi.stubEnv("BREVO_API_KEY", FAKE_KEY);
    // An SMTP host is also set (as on Railway), but must not be used.
    vi.stubEnv("ASSISTDESK_SMTP_HOST", "smtp.invalid");
    vi.stubEnv("ASSISTDESK_SMTP_FROM", "sender@example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const fetch = mockFetch(201, { messageId: "<1@brevo>" });

    const result = await sendVerificationEmail({ email: " new@example.com ", fullName: "Sam", verificationToken: "tok" });

    expect(result.status).toBe("SENT");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(FAKE_KEY);
    const body = JSON.parse(String(init.body));
    expect(body.sender).toEqual({ name: "AssistDesk", email: "sender@example.com" });
    expect(body.to).toEqual([{ email: "new@example.com" }]);
    expect(body.subject).toBe("Verify your AssistDesk account");
    expect(body.htmlContent).toContain("https://app.example.com/verify-email?token=tok");
    expect(body.textContent).toContain("https://app.example.com/verify-email?token=tok");
  });

  it("UT-65.02 a refused send is reported as FAILED with Brevo's reason, without throwing", async () => {
    vi.stubEnv("BREVO_API_KEY", FAKE_KEY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetch(400, { code: "invalid_parameter", message: "Sender is not valid" });

    const result = await sendPasswordResetEmail({ email: "a@example.com", fullName: "A", resetToken: "r" });

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Brevo refused the email (400): Sender is not valid");
  });

  it("UT-65.03 team alerts use Brevo too, and nothing is sent when no sender is configured", async () => {
    vi.stubEnv("BREVO_API_KEY", FAKE_KEY);
    const fetch = mockFetch(201, { messageId: "<2@brevo>" });
    expect(isPlatformEmailConfigured()).toBe(true);
    expect((await sendTeamEmail({ to: ["team@example.com"], subject: "New lead", text: "Hi" })).status).toBe("SENT");
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).to).toEqual([
      { email: "team@example.com" },
    ]);

    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("ASSISTDESK_SMTP_HOST", "");
    expect(isPlatformEmailConfigured()).toBe(false);
    expect((await sendTeamEmail({ to: ["team@example.com"], subject: "x", text: "y" })).status).toBe("NOT_CONFIGURED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
