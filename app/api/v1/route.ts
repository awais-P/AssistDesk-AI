import { apiRoute, describeKey } from "@/src/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/v1: the key's workspace and permissions (any valid key). */
export const GET = apiRoute(null, (context) => describeKey(context));
