import "server-only";
import { cookies } from "next/headers";
import type { Role } from "./pricing";

export const SALES_COOKIE = "inkab_sales";

function salesPassword(): string {
  return process.env.SALES_PASSWORD || "inkab";
}

/** Enkel rollmodell för prototypen. Ersätts av Auth.js i skarpt läge. */
export async function currentRole(): Promise<Role> {
  const store = await cookies();
  return store.get(SALES_COOKIE)?.value === salesPassword() ? "sales" : "guest";
}

export function checkPassword(candidate: string): boolean {
  return candidate === salesPassword();
}
