import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Module 3 against a real database, with the development TEST payment provider (no
 * Stripe key): the trial, plan limits on real routes, checkout, upgrade/downgrade with
 * proration, cancellation, renewal, AI-reply limit, the billing API and invoices.
 */

delete process.env.STRIPE_SECRET_KEY;

type SignedIn = { user: { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null } };
const signedIn: { current: SignedIn | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const billing = await import("@/src/lib/billing");
const billingRoute = await import("@/app/api/billing/route");
const actionRoute = await import("@/app/api/billing/[action]/route");
const invoiceRoute = await import("@/app/api/billing/invoices/[id]/route");
const usersRoute = await import("@/app/api/users/route");

const suffix = Date.now().toString(36);
let workspaceId = "";
let otherWorkspaceId = "";
let adminId = "";
const DAY = 86_400_000;

const as = (role: string, workspace = workspaceId) =>
  (signedIn.current = { user: { id: adminId, role, workspaceId: workspace, fullName: "Amna Admin", email: `billing-${suffix}@example.com`, customRole: null } });
const post = (action: string, body: unknown) => actionRoute.POST(new Request(`http://localhost/api/billing/${action}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });
const subscription = () => prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });
const invoices = () => prisma.invoice.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });

async function addMembers(count: number) {
  for (let index = 0; index < count; index += 1) {
    await prisma.user.create({ data: { workspaceId, fullName: `Member ${index}`, username: `m${index}-${suffix}-${Math.random().toString(36).slice(2, 6)}`, email: `m${index}-${Math.random().toString(36).slice(2, 8)}-${suffix}@example.com`, role: "AGENT" } });
  }
}

beforeAll(async () => {
  workspaceId = (await prisma.workspace.create({ data: { name: `Billing ${suffix}`, slug: `billing-${suffix}`, supportEmail: `billing-${suffix}@example.com` } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: `Billing other ${suffix}`, slug: `billing-other-${suffix}` } })).id;
  adminId = (await prisma.user.create({ data: { workspaceId, fullName: "Amna Admin", username: `billing-admin-${suffix}`, email: `billing-${suffix}@example.com`, role: "ADMIN" } })).id;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId] } } });
  await prisma.$disconnect();
});

describe("IT-26 subscription plans and payments (test provider) - Module 3 FE-1 to FE-5", () => {
  it("IT-26.01 a workspace from before billing is not limited", async () => {
    expect(await billing.checkLimit(otherWorkspaceId, "seats", 500)).toMatchObject({ allowed: true, plan: null });
  });

  it("IT-26.02 a new workspace starts a 14-day trial of Growth, whose limits apply", async () => {
    await billing.startTrial(workspaceId);
    const trial = await subscription();
    expect(trial).toMatchObject({ plan: "GROWTH", status: "TRIALING" });
    expect(Math.round((trial.trialEndsAt!.getTime() - Date.now()) / DAY)).toBe(14);

    await addMembers(8); // admin + 8 = 9 of 10 seats
    as("ADMIN");
    const tooMany = await usersRoute.POST(new Request("http://localhost/api/users", { method: "POST", body: JSON.stringify({ emails: [`a-${suffix}@example.com`, `b-${suffix}@example.com`] }) }));
    expect(tooMany.status).toBe(402);
    expect((await tooMany.json()).error).toContain("The Growth plan includes 10 team members");
  });

  it("IT-26.03 when the trial ends the workspace moves to Free and the team is told", async () => {
    await prisma.subscription.update({ where: { workspaceId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    expect(billing.effectivePlan(await subscription()).plan).toBe("FREE");
    await billing.runBillingMaintenance();
    expect(await subscription()).toMatchObject({ plan: "FREE", status: "ACTIVE" });
    expect(await prisma.notification.count({ where: { workspaceId, type: "BILLING", title: "Your free trial has ended" } })).toBe(1);
    expect(await billing.checkLimit(workspaceId, "seats")).toMatchObject({ allowed: false, limit: 2 });
  });

  it("IT-26.04 only people who manage billing can buy a plan; checkout activates it with a paid invoice", async () => {
    as("MANAGER");
    expect((await post("checkout", { plan: "GROWTH", interval: "MONTH" })).status).toBe(403);

    as("ADMIN");
    expect((await post("checkout", { plan: "FREE", interval: "MONTH" })).status).toBe(400);
    const response = await post("checkout", { plan: "STARTER", interval: "MONTH" });
    expect((await response.json()).url).toContain("/dashboard/billing?checkout=success");
    const active = await subscription();
    expect(active).toMatchObject({ plan: "STARTER", interval: "MONTH", status: "ACTIVE", provider: "TEST" });
    expect(active.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
    expect(await invoices()).toMatchObject([{ number: "TEST-0001", status: "PAID", amountPaid: 1900, plan: "STARTER" }]);
  });

  it("IT-26.05 an upgrade charges only the rest of the period; a downgrade below what is in use is refused", async () => {
    as("ADMIN");
    expect(await (await post("change", { plan: "GROWTH", interval: "MONTH" })).json()).toEqual({ direction: "upgrade" });
    const upgrade = (await invoices())[1];
    expect(upgrade.amountDue).toBeGreaterThan(2900);
    expect(upgrade.amountDue).toBeLessThanOrEqual(3000); // ($49 - $19) for almost the whole month

    const refused = await post("change", { plan: "STARTER", interval: "MONTH" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("Team members 9/3");
    expect((await post("change", { plan: "GROWTH", interval: "MONTH" })).status).toBe(400);
  });

  it("IT-26.06 cancelling keeps the plan to the end of the period, can be undone, then falls to Free", async () => {
    as("ADMIN");
    expect((await (await post("cancel", { cancel: true })).json()).cancelAtPeriodEnd).toBe(true);
    expect((await (await post("cancel", { cancel: false })).json()).cancelAtPeriodEnd).toBe(false);
    await post("cancel", { cancel: true });
    expect(billing.effectivePlan(await subscription()).plan).toBe("GROWTH");

    await prisma.subscription.update({ where: { workspaceId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await billing.runBillingMaintenance();
    expect(await subscription()).toMatchObject({ plan: "FREE", status: "ACTIVE", cancelAtPeriodEnd: false });
  });

  it("IT-26.07 an active plan renews automatically at the end of the period with a new invoice", async () => {
    as("ADMIN");
    await post("checkout", { plan: "GROWTH", interval: "YEAR" });
    const before = (await invoices()).length;
    const ends = new Date(Date.now() - 1000);
    await prisma.subscription.update({ where: { workspaceId }, data: { currentPeriodEnd: ends } });
    expect((await billing.runBillingMaintenance()).renewed).toBe(1);

    const renewed = await subscription();
    expect(renewed.currentPeriodStart!.getTime()).toBe(ends.getTime());
    expect(renewed.currentPeriodEnd!.getUTCFullYear()).toBe(ends.getUTCFullYear() + 1);
    const all = await invoices();
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toMatchObject({ amountPaid: 49000, interval: "YEAR", status: "PAID" });
  });

  it("IT-26.08 when the month's AI replies are used up the team is told and people answer", async () => {
    await prisma.subscription.update({ where: { workspaceId }, data: { plan: "FREE" } });
    await prisma.aiInteraction.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ workspaceId, channel: "WEB_WIDGET" as const, question: `q${index}`, latencyMs: 10 })) });
    expect(await billing.aiReplyAllowed(workspaceId)).toBe(false);
    expect(await billing.aiReplyAllowed(workspaceId)).toBe(false);
    expect(await prisma.notification.count({ where: { workspaceId, title: "AI replies for this month are used up" } })).toBe(1);
  });

  it("IT-26.09 the billing page data shows the plan, usage, invoices and history", async () => {
    as("AGENT");
    const body = await (await billingRoute.GET()).json();
    expect(body).toMatchObject({ mode: "test", canManage: false, effective: { plan: "FREE" }, limits: { aiReplies: 100 }, usage: { aiReplies: 100, seats: 9 } });
    expect(body.plans).toHaveLength(4);
    expect(body.invoices.length).toBeGreaterThanOrEqual(3);
    expect(body.events.map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining(["trial.ended", "subscription.activated", "subscription.renewed"]));
  });

  it("IT-26.10 an invoice is a printable page, for this workspace's billing managers only", async () => {
    const [first] = await invoices();
    as("ADMIN");
    const page = await invoiceRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: first.id }) });
    const html = await page.text();
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("TEST-0001");
    expect(html).toContain("$19");
    expect(html).toContain("Test mode: no real payment was taken.");

    as("AGENT");
    expect((await invoiceRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: first.id }) })).status).toBe(403);
    as("ADMIN", otherWorkspaceId);
    expect((await invoiceRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: first.id }) })).status).toBe(404);
  });
});
