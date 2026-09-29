import { redirect } from "next/navigation";
import { ContactsWorkspace } from "@/src/components/dashboard/contacts-workspace";
import { getCurrentSession } from "@/src/lib/auth";
import { loadContactList } from "@/src/lib/contact-list";

export default async function ContactsPage() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  const { total, contacts } = await loadContactList(session.user.workspaceId);

  return <ContactsWorkspace initialContacts={contacts} initialTotal={total} />;
}
