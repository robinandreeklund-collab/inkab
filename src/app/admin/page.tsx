import { redirect } from "next/navigation";
import { AdminApp } from "@/components/admin/AdminApp";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "INKAB Admin · maskinbibliotek" };

export default async function AdminPage() {
  // Rollen kontrolleras på servern; API-rutterna gör om kontrollen själva.
  const user = await currentUser();
  if (user?.role !== "admin") redirect("/?admin=1");
  return <AdminApp currentUserId={user.id} currentUserName={user.name || user.email} />;
}
