import { apiRoute, createTicketApi, listTicketsApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/tickets (?status, ?requester_email, ?limit, ?cursor) · POST creates a ticket. */
export const GET = apiRoute("tickets:read", listTicketsApi);
export const POST = apiRoute("tickets:write", createTicketApi);
