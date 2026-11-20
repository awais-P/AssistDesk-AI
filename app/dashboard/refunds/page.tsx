import { redirect } from "next/navigation";
import { RefundsWorkspace } from "@/src/components/dashboard/tools/refunds-workspace";
import { getCurrentSession } from "@/src/lib/auth";

/** Module 2 FE-1: refund requests collected by the AI, decided by the team. */
export default async function RefundsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <RefundsWorkspace />;
}
