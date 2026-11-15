import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { getWorkspaceSetupState } from "@/src/lib/setup";
import { SetupWizard } from "@/src/components/setup/setup-wizard";

export default async function SetupPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const setupState = await getWorkspaceSetupState(session.user.workspaceId);

  if (!setupState) {
    redirect("/login");
  }

  return (
    <SetupWizard
      user={{
        fullName: session.user.fullName,
        email: session.user.email,
      }}
      initialState={setupState}
    />
  );
}
