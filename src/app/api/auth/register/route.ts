import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, createSessionToken, registerUser } from "@/lib/server/auth";
import { sessionCookieOptions } from "../cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email("Ogiltig e-postadress.").max(160),
  password: z.string().min(8, "Lösenordet måste vara minst 8 tecken.").max(200),
  name: z.string().min(1, "Namn krävs.").max(80),
  company: z.string().max(120).default(""),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ogiltiga uppgifter." },
      { status: 400 },
    );
  }

  try {
    const user = await registerUser(parsed.data);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Registreringen misslyckades." },
      { status: 409 },
    );
  }
}
