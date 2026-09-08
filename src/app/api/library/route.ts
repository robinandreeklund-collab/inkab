import { NextResponse } from "next/server";
import { activeContext } from "@/lib/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Det aktiva maskinbiblioteket. Innehåller medvetet inga priser. */
export async function GET() {
  const { library } = await activeContext();
  return NextResponse.json({ machines: library.machines });
}
