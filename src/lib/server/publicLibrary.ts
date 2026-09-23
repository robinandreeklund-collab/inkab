import "server-only";
import type { Machine } from "@/lib/types";

/**
 * Maskinen som den får lämna servern till en som inte ska se priser.
 *
 * Priser ligger inte bara i prisboken. Maskindatan bär dem också: en
 * parametrisk längd har ett pris per meter, och en parameters val kan bära
 * ett påslag. De fälten behövs bara när priset räknas, och det sker på
 * servern — konfiguratorn ritar geometri, den räknar aldrig kronor.
 *
 * Fälten tas bort i stället för att nollställas. Ett pris på noll är ett
 * påstående om priset; ett fält som inte finns är det inte.
 */
export function withoutPrices(machine: Machine): Machine {
  const { parametricLength, parameters, ...rest } = machine;

  return {
    ...rest,
    ...(parametricLength
      ? {
          parametricLength: (() => {
            const { pricePerMeter: _pris, ...matt } = parametricLength;
            return matt as typeof parametricLength;
          })(),
        }
      : {}),
    ...(parameters
      ? {
          parameters: parameters.map((parameter) => {
            const {
              pricePerUnit: _perEnhet,
              priceWhenTrue: _nar,
              choices,
              ...kvar
            } = parameter;
            return {
              ...kvar,
              ...(choices
                ? {
                    choices: choices.map(({ priceDelta: _delta, ...val }) => val),
                  }
                : {}),
            } as typeof parameter;
          }),
        }
      : {}),
  };
}
