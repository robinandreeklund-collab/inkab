import { NextResponse } from "next/server";
import { z } from "zod";
import { SALES_COOKIE, checkPassword, currentRole } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ role: await currentRole() });
}

const bodySchema = z.object({ password: z.string().max(200).optional() });

/** Prototypens rollväxling. Ersätts av Auth.js med riktig inloggning. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const password = parsed.success ? parsed.data.password : undefined;

  if (!password) {
    const response = NextResponse.json({ role: "guest" });
    response.cookies.delete(SALES_COOKIE);
    return response;
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Fel lösenord." }, { status: 401 });
  }

  const response = NextResponse.json({ role: "sales" });
  response.cookies.set(SALES_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}
