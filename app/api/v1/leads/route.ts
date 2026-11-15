import { apiRoute, createLeadApi, listLeadsApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/leads (?status) · POST creates a lead (or updates the customer's open one). */
export const GET = apiRoute("leads:read", listLeadsApi);
export const POST = apiRoute("leads:write", createLeadApi);
