import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { ProfileForm } from "@/src/components/dashboard/profile-form";

export default async function ProfilePage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: session.user.id,
    },
    include: {
      workspace: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  return (
    <ProfileForm
      fullName={user.fullName}
      email={user.email}
      username={user.username}
      role={user.role}
      workspaceName={user.workspace.name}
    />
  );
}
