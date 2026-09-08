import "server-only";
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import {
  findUserByEmail,
  findUserById,
  insertUser,
  type StoredUser,
} from "./store";
import type { Role } from "./pricing";

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = "inkab_session";
const SESSION_HOURS = 12;

/**
 * Kontohantering för prototypen: scrypt-hashade lösenord och en HMAC-signerad
 * sessionscookie. Ingen sessionstabell behövs — cookien bär användar-id och
 * utgångstid, och signaturen gör den omöjlig att förfalska.
 *
 * I skarpt läge ersätts detta av Auth.js med magisk länk för kund och
 * Entra ID internt. Då försvinner lösenordshanteringen helt.
 */

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  // Utan satt hemlighet blir sessionerna ogiltiga vid omstart. Det är rätt
  // beteende: hellre utloggad än en förutsägbar signeringsnyckel.
  return bootSecret;
}
const bootSecret = randomBytes(32).toString("hex");

/** E-postadresser som blir admin automatiskt vid registrering. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "robin@inkab.nu,daniel@inkab.nu,lars@inkab.nu")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

/* ── Lösenord ──────────────────────────────────────────────────────────── */

async function hash(password: string, salt: string): Promise<string> {
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, 64)) as Buffer;
  return derived.toString("hex");
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  return { hash: await hash(password, salt), salt };
}

export async function verifyPassword(
  password: string,
  user: Pick<StoredUser, "passwordHash" | "salt">,
): Promise<boolean> {
  const candidate = Buffer.from(await hash(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  // Längdskillnad först: timingSafeEqual kastar på olika längder.
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/* ── Sessioner ─────────────────────────────────────────────────────────── */

type SessionPayload = { uid: string; exp: number };

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

function sign(data: string): string {
  return createHmac("sha256", authSecret()).update(data).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    uid: userId,
    exp: Date.now() + SESSION_HOURS * 3600_000,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function readSessionToken(token: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

/* ── Publikt API ───────────────────────────────────────────────────────── */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: Role;
};

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = readSessionToken(token);
  if (!payload) return null;

  const user = await findUserById(payload.uid);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    company: user.company,
    role: user.role,
  };
}

export async function currentRole(): Promise<Role> {
  return (await currentUser())?.role ?? "guest";
}

export type RegisterInput = {
  email: string;
  password: string;
  name: string;
  company: string;
};

export async function registerUser(input: RegisterInput): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();

  if (await findUserByEmail(email)) {
    throw new Error("E-postadressen är redan registrerad.");
  }

  const { hash: passwordHash, salt } = await hashPassword(input.password);
  const user: StoredUser = {
    id: randomUUID(),
    email,
    name: input.name.trim(),
    company: input.company.trim(),
    role: isAdminEmail(email) ? "admin" : "customer",
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };

  await insertUser(user);

  return { id: user.id, email: user.email, name: user.name, company: user.company, role: user.role };
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Kör ändå en hashning så att svarstiden inte avslöjar om kontot finns.
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword(password, user))) return null;

  return { id: user.id, email: user.email, name: user.name, company: user.company, role: user.role };
}
