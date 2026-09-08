import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, isAdminEmail } from "@/lib/server/auth";
import { deleteUser, listUsers, updateUserRole } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard() {
  const user = await currentUser();
  if (user?.role !== "admin") {
    return { denied: NextResponse.json({ error: "Kräver adminbehörighet." }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const { denied } = await guard();
  if (denied) return denied;

  const users = await listUsers();
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      company: u.company,
      role: u.role,
      createdAt: u.createdAt,
      // Adressen får sin adminroll av miljövariabeln och kan inte nedgraderas här.
      lockedAdmin: isAdminEmail(u.email),
    })),
  });
}

const patchSchema = z.object({
  id: z.string().min(1).max(64),
  role: z.enum(["customer", "sales", "admin"]),
});

export async function PATCH(request: Request) {
  const { denied, user } = await guard();
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
  if (parsed.data.id === user!.id) {
    return NextResponse.json(
      { error: "Du kan inte ändra din egen roll." },
      { status: 400 },
    );
  }

  await updateUserRole(parsed.data.id, parsed.data.role);
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ id: z.string().min(1).max(64) });

export async function DELETE(request: Request) {
  const { denied, user } = await guard();
  if (denied) return denied;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
  if (parsed.data.id === user!.id) {
    return NextResponse.json({ error: "Du kan inte ta bort ditt eget konto." }, { status: 400 });
  }

  await deleteUser(parsed.data.id);
  return NextResponse.json({ ok: true });
}
