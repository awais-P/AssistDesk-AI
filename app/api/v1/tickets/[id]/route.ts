import { apiRoute, getTicketApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/tickets/{id}: a ticket with its messages (internal notes left out). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return apiRoute("tickets:read", (api) => getTicketApi(api, id))(request);
}
