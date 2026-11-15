import { redirect } from "next/navigation";
import { BillingWorkspace } from "@/src/components/dashboard/billing-workspace";
import { getCurrentSession } from "@/src/lib/auth";

type BillingPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Module 3: plans, usage, invoices and payment history. */
export default async function BillingPage({ searchParams }: BillingPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;

  return <BillingWorkspace checkout={checkout ?? null} />;
}
