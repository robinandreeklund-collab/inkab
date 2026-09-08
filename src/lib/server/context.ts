import "server-only";
import { makeLibrary, type MachineLibrary } from "@/lib/library";
import { readDocument } from "./store";
import type { PriceBook } from "./pricebook";
import type { Machine } from "@/lib/types";

/**
 * Det aktiva biblioteket och prisboken, som de ser ut efter admins ändringar.
 * All serverkod ska gå via den här funktionen i stället för att importera de
 * inbyggda konstanterna direkt.
 */
export async function activeContext(): Promise<{
  library: MachineLibrary;
  priceBook: PriceBook;
}> {
  const doc = await readDocument();
  return {
    library: makeLibrary(doc.machines as Machine[]),
    priceBook: doc.priceBook as PriceBook,
  };
}
