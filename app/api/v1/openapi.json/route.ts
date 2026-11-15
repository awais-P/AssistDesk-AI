import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/src/lib/public-api-spec";

/** The public API described in OpenAPI 3.1 (no key needed to read the description). */
export function GET() {
  return NextResponse.json(OPENAPI_SPEC, { headers: { "Cache-Control": "public, max-age=300" } });
}
