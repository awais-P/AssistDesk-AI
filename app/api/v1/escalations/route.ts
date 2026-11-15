import { apiRoute, listEscalationsApi } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1/escalations (?status=PENDING|ACCEPTED|RESOLVED). */
export const GET = apiRoute("escalations:read", listEscalationsApi);
