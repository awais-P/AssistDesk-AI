import { apiRoute, listConversationsApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/conversations (?status, ?channel). */
export const GET = apiRoute("conversations:read", listConversationsApi);
