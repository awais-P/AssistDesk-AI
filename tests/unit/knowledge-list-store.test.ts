import { beforeEach, describe, expect, it, vi } from "vitest";

/** SRS CON-2: the Zustand store behind the knowledge base table's filters. */

// The browser's per-tab storage (Node has none).
const tabStorage = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (key: string) => tabStorage.get(key) ?? null,
  setItem: (key: string, value: string) => void tabStorage.set(key, value),
  removeItem: (key: string) => void tabStorage.delete(key),
});

const { KNOWLEDGE_LIST_DEFAULTS, useKnowledgeListStore } = await import("@/src/lib/stores/knowledge-list-store");

describe("UT-73 knowledge base view store (Zustand) - SRS CON-2, FR-10.6", () => {
  beforeEach(() => useKnowledgeListStore.getState().reset());

  it("UT-73.01 starts with the defaults: everything, newest first, 10 a page", () => {
    expect(useKnowledgeListStore.getState()).toMatchObject(KNOWLEDGE_LIST_DEFAULTS);
  });

  it("UT-73.02 changing a filter, the sort or the page size goes back to the first page", () => {
    const store = useKnowledgeListStore.getState();
    for (const change of [
      () => store.setSearch("refund"),
      () => store.setTypeFilter("FILE"),
      () => store.setStatusFilter("FAILED"),
      () => store.setAgentFilter("UNASSIGNED"),
      () => store.setSortKey("NAME"),
      () => store.setPageSize(50),
    ]) {
      store.setPage(3);
      change();
      expect(useKnowledgeListStore.getState().page).toBe(1);
    }
    expect(useKnowledgeListStore.getState()).toMatchObject({ search: "refund", typeFilter: "FILE", statusFilter: "FAILED", agentFilter: "UNASSIGNED", sortKey: "NAME", pageSize: 50 });
  });

  it("UT-73.03 the page never goes below 1, and reset clears the view", () => {
    const store = useKnowledgeListStore.getState();
    store.setPage(0);
    expect(useKnowledgeListStore.getState().page).toBe(1);
    store.setSearch("pricing");
    store.reset();
    expect(useKnowledgeListStore.getState()).toMatchObject(KNOWLEDGE_LIST_DEFAULTS);
  });

  it("UT-73.04 the view is saved for the tab under its own key and restored by rehydrate", async () => {
    const store = useKnowledgeListStore.getState();
    store.setStatusFilter("FAILED");
    store.setSearch("returns");

    const saved = JSON.parse(tabStorage.get("assistdesk.knowledge-list")!);
    expect(saved.state).toEqual({ ...KNOWLEDGE_LIST_DEFAULTS, statusFilter: "FAILED", search: "returns" });
    // Only the view, no functions.
    expect(Object.keys(saved.state).sort()).toEqual(["agentFilter", "page", "pageSize", "search", "sortKey", "statusFilter", "typeFilter"]);

    // A fresh page: defaults first (server and browser match), then this tab's view.
    useKnowledgeListStore.setState(KNOWLEDGE_LIST_DEFAULTS);
    tabStorage.set("assistdesk.knowledge-list", JSON.stringify(saved));
    expect(useKnowledgeListStore.persist.getOptions().skipHydration).toBe(true);
    await useKnowledgeListStore.persist.rehydrate();
    expect(useKnowledgeListStore.getState()).toMatchObject({ statusFilter: "FAILED", search: "returns" });
  });
});
