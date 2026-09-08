import "server-only";
import { currentRole as roleFromSession, currentUser } from "./auth";
import type { Role } from "./pricing";

export { SESSION_COOKIE } from "./auth";

export async function currentRole(): Promise<Role> {
  return roleFromSession();
}

export async function requireAdmin(): Promise<boolean> {
  return (await roleFromSession()) === "admin";
}

export { currentUser };
