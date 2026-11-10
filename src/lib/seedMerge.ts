import type { LibraryDocument } from "@/lib/machineSchema";

/**
 * Grundmaskinerna i `data/library.json` ska finnas efter varje deploy, även
 * när databasen har ett sparat bibliotek som är äldre än filen.
 *
 * Databasen vinner för allt admin har ändrat. Det enda som läggs till är det
 * databasen saknar helt:
 *   - maskiner vars id inte finns i databasen, med sin prisrad,
 *   - en modell till en maskin som saknar modell i databasen men har en i
 *     utgångsläget — då följer CAD-måtten, portarna och zonerna med, eftersom
 *     de hör ihop med modellen.
 */
export function mergeSeedInto(
  stored: LibraryDocument,
  seed: LibraryDocument,
): { document: LibraryDocument; changed: boolean } {
  const machines = stored.machines.map((m) => ({ ...m }));
  const entries = { ...stored.priceBook.entries };
  const byId = new Map(machines.map((m, i) => [m.id, i]));
  let changed = false;

  for (const seedMachine of seed.machines) {
    const index = byId.get(seedMachine.id);
    if (index === undefined) {
      if (machines.length >= 200) break;
      machines.push(JSON.parse(JSON.stringify(seedMachine)));
      changed = true;
    } else if (!machines[index].model && seedMachine.model) {
      machines[index] = {
        ...machines[index],
        model: { ...seedMachine.model },
        footprint: { ...seedMachine.footprint },
        ports: JSON.parse(JSON.stringify(seedMachine.ports)),
        zones: JSON.parse(JSON.stringify(seedMachine.zones)),
      };
      changed = true;
    }
    if (!(seedMachine.id in entries) && seedMachine.id in seed.priceBook.entries) {
      entries[seedMachine.id] = JSON.parse(
        JSON.stringify(seed.priceBook.entries[seedMachine.id]),
      );
      changed = true;
    }
  }

  if (!changed) return { document: stored, changed };
  return {
    document: { ...stored, machines, priceBook: { ...stored.priceBook, entries } },
    changed,
  };
}
