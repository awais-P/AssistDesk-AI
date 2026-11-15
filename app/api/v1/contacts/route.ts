import { apiRoute, listContactsApi, upsertContactApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/contacts (?email) · POST creates or updates a customer by email/phone. */
export const GET = apiRoute("contacts:read", listContactsApi);
export const POST = apiRoute("contacts:write", upsertContactApi);
