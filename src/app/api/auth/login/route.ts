import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, authenticate, createSessionToken } from "@/lib/server/auth";
import { sessionCookieOptions } from "../cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Fyll i e-post och lösenord." }, { status: 400 });
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    // Samma svar oavsett om kontot saknas eller lösenordet är fel.
    return NextResponse.json({ error: "Fel e-postadress eller lösenord." }, { status: 401 });
  }

  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
  return response;
}
