import { apiRoute, getConversationApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/conversations/{id}: the conversation with its transcript. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return apiRoute("conversations:read", (api) => getConversationApi(api, id))(request);
}
