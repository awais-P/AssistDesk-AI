import { redirect } from "next/navigation";
import { EscalationsWorkspace } from "@/src/components/dashboard/escalations-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { ESCALATION_VIEWS, type EscalationView } from "@/src/lib/escalation-queries";

type EscalationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Module 9 - Support Escalation: the queue of conversations handed to the team. */
export default async function EscalationsPage({ searchParams }: EscalationsPageProps) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const view = first(params.view);

  return (
    <EscalationsWorkspace
      initialView={view && (ESCALATION_VIEWS as string[]).includes(view) ? (view as EscalationView) : "queue"}
      focusId={first(params.id)}
    />
  );
}
