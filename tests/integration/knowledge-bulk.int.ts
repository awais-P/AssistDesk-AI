import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/src/lib/prisma";

/**
 * Knowledge base table (FR-10.2, FR-10.6): a legacy Word .doc is uploaded and indexed,
 * and several sources are re-indexed or deleted at once. Only sources of the caller's
 * workspace are touched; agents can't use the bulk actions.
 */

type SessionUser = { id: string; role: string; workspaceId: string; fullName: string; email: string; customRole: null };
const signedIn: { current: { user: SessionUser } | null } = { current: null };

vi.mock("@/src/lib/auth", async (original) => ({
  ...(await original<typeof import("@/src/lib/auth")>()),
  getCurrentSession: async () => signedIn.current,
}));

const knowledge = await import("@/app/api/knowledge-sources/route");
const bulk = await import("@/app/api/knowledge-sources/bulk/route");

const suffix = Date.now().toString(36);
const DOC = readFileSync(path.join(process.cwd(), "tests", "fixtures", "returns-policy.doc"));
let workspaceId = "";
let otherWorkspaceId = "";
let manager: SessionUser;
let agent: SessionUser;

const runBulk = (body: Record<string, unknown>) =>
  bulk.POST(new Request("http://localhost/api/knowledge-sources/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

async function textSource(title: string, workspace = workspaceId) {
  return (await prisma.knowledgeSource.create({ data: { workspaceId: workspace, title, type: "TEXT", rawText: `${title}: delivery takes three days.`, status: "SYNCED" } })).id;
}

async function waitForStatus(id: string, wanted: string[]) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const source = await prisma.knowledgeSource.findUnique({ where: { id }, select: { status: true, chunkCount: true, processingError: true } });
    if (source && wanted.includes(source.status)) return source;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Source ${id} never reached ${wanted.join("/")}`);
}

beforeAll(async () => {
  vi.stubEnv("ASSISTDESK_DEFAULT_OPENROUTER_API_KEY", ""); // offline embeddings: no provider call
  vi.stubEnv("ASSISTDESK_DEFAULT_GOOGLE_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("PINECONE_API_KEY", "");
  const [workspace, other] = await Promise.all([
    prisma.workspace.create({ data: { name: `KB ${suffix}`, slug: `kb-${suffix}`, supportEmail: `kb-${suffix}@example.com`, settings: { create: {} } } }),
    prisma.workspace.create({ data: { name: `KB other ${suffix}`, slug: `kb-other-${suffix}`, supportEmail: `kb-other-${suffix}@example.com`, settings: { create: {} } } }),
  ]);
  workspaceId = workspace.id;
  otherWorkspaceId = other.id;
  const [managerRow, agentRow] = await Promise.all([
    prisma.user.create({ data: { workspaceId, fullName: "Mona Manager", username: `kb-manager-${suffix}`, email: `kb-manager-${suffix}@example.com`, role: "MANAGER", isEmailVerified: true } }),
    prisma.user.create({ data: { workspaceId, fullName: "Ali Agent", username: `kb-agent-${suffix}`, email: `kb-agent-${suffix}@example.com`, role: "AGENT", isEmailVerified: true } }),
  ]);
  manager = { id: managerRow.id, role: "MANAGER", workspaceId, fullName: "Mona Manager", email: managerRow.email, customRole: null };
  agent = { id: agentRow.id, role: "AGENT", workspaceId, fullName: "Ali Agent", email: agentRow.email, customRole: null };
  signedIn.current = { user: manager };
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.workspace.deleteMany({ where: { id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } } });
});

describe("IT-33 knowledge base table: .doc files and bulk actions (FR-10.2, FR-10.6)", () => {
  it("IT-33.01 a Word .doc is uploaded, read and indexed", async () => {
    const form = new FormData();
    form.set("title", "Returns (Word 97)");
    form.set("type", "FILE");
    form.set("file", new File([DOC], "returns-policy.doc", { type: "application/msword" }));
    const response = await knowledge.POST(new Request("http://localhost/api/knowledge-sources", { method: "POST", body: form }));
    expect(response.ok).toBe(true);
    const { knowledgeSource } = (await response.json()) as { knowledgeSource: { id: string } };

    const indexed = await waitForStatus(knowledgeSource.id, ["SYNCED", "FAILED"]);
    expect(indexed.processingError).toBeNull();
    expect(indexed).toMatchObject({ status: "SYNCED" });
    expect(indexed.chunkCount).toBeGreaterThan(0);
    const chunks = await prisma.knowledgeChunk.findMany({ where: { sourceId: knowledgeSource.id }, select: { content: true } });
    expect(chunks.map((chunk) => chunk.content).join(" ")).toContain("returned within 30 days of delivery");
  });

  it("IT-33.02 several sources are re-indexed at once; another workspace's are skipped", async () => {
    const mine = [await textSource("Shipping"), await textSource("Warranty")];
    const theirs = await textSource("Their secret", otherWorkspaceId);

    const response = await runBulk({ action: "reindex", ids: [...mine, theirs] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ action: "reindex", processed: 2, skipped: 1 });
    for (const id of mine) await waitForStatus(id, ["SYNCED"]);
    expect((await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: theirs } })).status).toBe("SYNCED"); // untouched
    expect(await prisma.auditLog.count({ where: { workspaceId, action: "knowledge.reindexed" } })).toBe(1);
  });

  it("IT-33.03 several sources are deleted at once with their chunks; another workspace's survive", async () => {
    const mine = [await textSource("Old FAQ"), await textSource("Old prices")];
    const theirs = await textSource("Keep me", otherWorkspaceId);

    const response = await runBulk({ action: "delete", ids: [...mine, theirs] });
    expect(await response.json()).toMatchObject({ action: "delete", processed: 2, failed: [], skipped: 1 });
    expect(await prisma.knowledgeSource.count({ where: { id: { in: mine } } })).toBe(0);
    expect(await prisma.knowledgeChunk.count({ where: { sourceId: { in: mine } } })).toBe(0);
    expect(await prisma.knowledgeSource.count({ where: { id: theirs } })).toBe(1);
  });

  it("IT-33.04 agents can't use bulk actions, and requests are checked", async () => {
    const id = await textSource("Guarded");
    signedIn.current = { user: agent };
    expect((await runBulk({ action: "delete", ids: [id] })).status).toBe(403);
    signedIn.current = { user: manager };

    expect((await runBulk({ action: "archive", ids: [id] })).status).toBe(400);
    expect((await runBulk({ action: "delete", ids: [] })).status).toBe(400);
    expect((await runBulk({ action: "delete", ids: Array.from({ length: 101 }, (_, index) => `id-${index}`) })).status).toBe(400);
    expect(await prisma.knowledgeSource.count({ where: { id } })).toBe(1);
  });
});
