import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * SRS CON-2: Zustand for client state. How the knowledge base table is filtered, sorted
 * and paged. Kept for the browser tab (sessionStorage), so opening a source and coming
 * back keeps the same view. The store starts with the defaults and is filled from
 * sessionStorage after the page has hydrated (`skipHydration`), so the server and
 * browser render the same first frame.
 */
export type KnowledgeTypeFilter = "ALL" | "FILE" | "URL" | "TEXT";
export type KnowledgeStatusFilter = "ALL" | "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "DELETED";
export type KnowledgeSortKey = "NEWEST" | "OLDEST" | "NAME" | "LAST_SYNCED";

type KnowledgeListView = {
  search: string;
  typeFilter: KnowledgeTypeFilter;
  statusFilter: KnowledgeStatusFilter;
  agentFilter: string;
  sortKey: KnowledgeSortKey;
  pageSize: number;
  page: number;
};

type KnowledgeListStore = KnowledgeListView & {
  setSearch: (value: string) => void;
  setTypeFilter: (value: KnowledgeTypeFilter) => void;
  setStatusFilter: (value: KnowledgeStatusFilter) => void;
  setAgentFilter: (value: string) => void;
  setSortKey: (value: KnowledgeSortKey) => void;
  setPageSize: (value: number) => void;
  setPage: (value: number) => void;
  reset: () => void;
};

export const KNOWLEDGE_LIST_DEFAULTS: KnowledgeListView = {
  search: "",
  typeFilter: "ALL",
  statusFilter: "ALL",
  agentFilter: "ALL",
  sortKey: "NEWEST",
  pageSize: 10,
  page: 1,
};

export const useKnowledgeListStore = create<KnowledgeListStore>()(
  persist(
    (set) => ({
      ...KNOWLEDGE_LIST_DEFAULTS,
      // Changing what is shown starts again from the first page.
      setSearch: (search) => set({ search, page: 1 }),
      setTypeFilter: (typeFilter) => set({ typeFilter, page: 1 }),
      setStatusFilter: (statusFilter) => set({ statusFilter, page: 1 }),
      setAgentFilter: (agentFilter) => set({ agentFilter, page: 1 }),
      setSortKey: (sortKey) => set({ sortKey, page: 1 }),
      setPageSize: (pageSize) => set({ pageSize, page: 1 }),
      setPage: (page) => set({ page: Math.max(1, page) }),
      reset: () => set(KNOWLEDGE_LIST_DEFAULTS),
    }),
    {
      name: "assistdesk.knowledge-list",
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: ({ search, typeFilter, statusFilter, agentFilter, sortKey, pageSize, page }) => ({
        search,
        typeFilter,
        statusFilter,
        agentFilter,
        sortKey,
        pageSize,
        page,
      }),
    },
  ),
);
