import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user, role: user?.role ?? "guest" });
}
