import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { billingMode, startTrial } from "@/src/lib/billing";
import { prisma } from "@/src/lib/prisma";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("UT-64 production deployment - Railway", () => {
  it("UT-64.01 the health check answers 200 when the database responds and 503 when it doesn't", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as never);
    const ok = await health();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("connection refused"));
    const down = await health();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false });
  });

  it("UT-64.02 with payments off in production, a new workspace gets no trial that could never be paid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const upsert = vi.spyOn(prisma.subscription, "upsert");
    expect(billingMode()).toBe("off");
    expect(await startTrial("ws_production")).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("UT-64.03 the build loads without DATABASE_URL, but the running server still requires it", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.resetModules();
    await expect(import("@/src/lib/prisma")).resolves.toHaveProperty("prisma");

    vi.stubEnv("NEXT_PHASE", "");
    vi.resetModules();
    await expect(import("@/src/lib/prisma")).rejects.toThrow("DATABASE_URL is not configured.");
    vi.resetModules();
  });
});
