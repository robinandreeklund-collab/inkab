import { NextResponse } from "next/server";
import { activeContext } from "@/lib/server/context";
import { withoutPrices } from "@/lib/server/publicLibrary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Det aktiva maskinbiblioteket, utan priser.
 *
 * Rutten är öppen — konfiguratorn behöver maskinerna innan någon loggat in —
 * så allt som lämnar den är publikt. Prisuppgifterna ligger inte bara i
 * prisboken utan också i maskindatan: `parametricLength.pricePerMeter` och
 * `parameters[].choices[].priceDelta`. Här stod det att biblioteket inte
 * innehåller några priser, och det var inte sant: 18 000 kr per meter och
 * ett tillval på 74 000 låg i svaret till vem som helst.
 *
 * Fälten behövs bara när priset räknas, och det sker på servern.
 */
export async function GET() {
  const { library } = await activeContext();
  return NextResponse.json({ machines: library.machines.map(withoutPrices) });
}
