import { NextResponse } from "next/server";
import { isSampleStoreAuthorized, isSampleStoreEnabled, sampleOrder } from "@/src/lib/sample-store";

type SampleOrderRouteContext = { params: Promise<{ number: string }> };

/** Sample store: order status (demo for the "order tracking" HTTP tool). */
export async function GET(request: Request, context: SampleOrderRouteContext) {
  if (!isSampleStoreEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!isSampleStoreAuthorized(request)) {
    return NextResponse.json({ error: "Missing or wrong API key." }, { status: 401 });
  }

  const { number } = await context.params;
  const order = sampleOrder(number);

  return order ? NextResponse.json(order) : NextResponse.json({ error: "Order not found." }, { status: 404 });
}
