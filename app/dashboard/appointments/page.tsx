import { redirect } from "next/navigation";
import { AppointmentsWorkspace } from "@/src/components/dashboard/tools/appointments-workspace";
import { getCurrentSession } from "@/src/lib/auth";

/** Module 2 FE-1: appointments booked by the AI or the team. */
export default async function AppointmentsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return <AppointmentsWorkspace />;
}
