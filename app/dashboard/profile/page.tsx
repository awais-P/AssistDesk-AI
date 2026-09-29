import { redirect } from "next/navigation";
import { getCurrentSession } from "@/src/lib/auth";
import { prisma } from "@/src/lib/prisma";
import { roleDescriptions, type WorkspaceRole } from "@/src/lib/rbac";
import { ProfileForm } from "@/src/components/dashboard/profile-form";

type ProfilePageProps = {
  searchParams: Promise<{
    changePassword?: string | string[];
  }>;
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const [{ changePassword }, user] = await Promise.all([
    searchParams,
    prisma.user.findUnique({
      where: {
        id: session.user.id,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        username: true,
        role: true,
        mustChangePassword: true,
        workspace: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  if (!user) {
    redirect("/login");
  }

  return (
    <ProfileForm
      fullName={user.fullName}
      email={user.email}
      username={user.username}
      role={user.role}
      roleDescription={roleDescriptions[user.role as WorkspaceRole] ?? ""}
      workspaceName={user.workspace.name}
      mustChangePassword={user.mustChangePassword}
      focusPasswordCard={changePassword === "1"}
    />
  );
}
