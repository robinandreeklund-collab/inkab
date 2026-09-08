import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_MACHINES } from "@/lib/library";
import { libraryDocumentSchema, type LibraryDocument } from "@/lib/machineSchema";
import { BUILTIN_PRICE_BOOK } from "./pricebook";

/**
 * Maskinbiblioteket och prisboken lagras som ETT dokument.
 *
 * Tre nivåer, i den ordningen:
 *   1. `data/library.json` i repot, om den finns — det versionshanterade
 *      utgångsläget. Exportera från admin-vyn och committa filen.
 *   2. Postgres, om DATABASE_URL är satt — admins ändringar överlever omstart.
 *   3. Minne — ändringarna lever så länge servern gör det. Admin-vyn säger
 *      det rakt ut och erbjuder export så att inget går förlorat i tysthet.
 */

export type StorageMode = "postgres" | "memory";

export type StoreStatus = {
  mode: StorageMode;
  persistent: boolean;
  seedSource: "data/library.json" | "inbyggd";
  updatedAt: string | null;
  updatedBy: string | null;
  /** Sätts när Postgres är konfigurerad men inte gick att nå. */
  degradedReason: string | null;
};

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: "customer" | "sales" | "admin";
  passwordHash: string;
  salt: string;
  createdAt: string;
};

let memoryDoc: LibraryDocument | null = null;
const memoryUsers = new Map<string, StoredUser>();
let seedCache: LibraryDocument | null = null;
let seedSource: StoreStatus["seedSource"] = "inbyggd";
let degradedReason: string | null = null;

function builtinDocument(): LibraryDocument {
  return {
    machines: JSON.parse(JSON.stringify(BUILTIN_MACHINES)),
    priceBook: JSON.parse(JSON.stringify(BUILTIN_PRICE_BOOK)),
    assets: [],
  };
}

/** Läser det versionshanterade utgångsläget, med de inbyggda som reserv. */
async function readSeed(): Promise<LibraryDocument> {
  if (seedCache) return seedCache;

  try {
    const file = path.join(process.cwd(), "data", "library.json");
    const raw = await readFile(file, "utf-8");
    const parsed = libraryDocumentSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      seedCache = parsed.data as LibraryDocument;
      seedSource = "data/library.json";
      return seedCache;
    }
    console.warn(
      "data/library.json är ogiltig och ignoreras:",
      parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  } catch {
    // Filen saknas — helt normalt innan första exporten.
  }

  seedCache = builtinDocument();
  seedSource = "inbyggd";
  return seedCache;
}

/* ── Postgres ──────────────────────────────────────────────────────────── */

type PgPool = import("pg").Pool;
let poolPromise: Promise<PgPool> | null = null;

async function getPool(): Promise<PgPool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // Render, Neon och Supabase kräver TLS men använder egna certifikat.
        ssl: process.env.DATABASE_URL?.includes("localhost")
          ? undefined
          : { rejectUnauthorized: false },
        max: 3,
        connectionTimeoutMillis: 8000,
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS library_document (
          id          text PRIMARY KEY,
          doc         jsonb NOT NULL,
          updated_at  timestamptz NOT NULL DEFAULT now(),
          updated_by  text
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_user (
          id            text PRIMARY KEY,
          email         text UNIQUE NOT NULL,
          name          text NOT NULL DEFAULT '',
          company       text NOT NULL DEFAULT '',
          role          text NOT NULL DEFAULT 'customer',
          password_hash text NOT NULL,
          salt          text NOT NULL,
          created_at    timestamptz NOT NULL DEFAULT now()
        )
      `);
      return pool;
    })();
  }
  return poolPromise;
}

function postgresConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/* ── Publikt API ───────────────────────────────────────────────────────── */

export async function readDocument(): Promise<LibraryDocument> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      const result = await pool.query<{ doc: unknown; updated_at: Date; updated_by: string | null }>(
        "SELECT doc, updated_at, updated_by FROM library_document WHERE id = 'current'",
      );
      degradedReason = null;
      if (result.rows.length > 0) {
        const parsed = libraryDocumentSchema.safeParse(result.rows[0].doc);
        if (parsed.success) {
          return {
            ...(parsed.data as LibraryDocument),
            updatedAt: result.rows[0].updated_at.toISOString(),
            updatedBy: result.rows[0].updated_by ?? undefined,
          };
        }
        console.warn("Dokumentet i databasen är ogiltigt; faller tillbaka på utgångsläget.");
      }
      return readSeed();
    } catch (error) {
      // Databasen är otillgänglig — verktyget ska fortsätta fungera.
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  if (memoryDoc) return memoryDoc;
  return readSeed();
}

export async function writeDocument(
  doc: LibraryDocument,
  updatedBy: string,
): Promise<{ persisted: boolean; reason: string | null }> {
  const stamped: LibraryDocument = {
    ...doc,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO library_document (id, doc, updated_at, updated_by)
         VALUES ('current', $1, now(), $2)
         ON CONFLICT (id) DO UPDATE SET doc = $1, updated_at = now(), updated_by = $2`,
        [JSON.stringify(stamped), updatedBy],
      );
      degradedReason = null;
      memoryDoc = stamped;
      return { persisted: true, reason: null };
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
      memoryDoc = stamped;
      return { persisted: false, reason: degradedReason };
    }
  }

  memoryDoc = stamped;
  return { persisted: false, reason: "Ingen DATABASE_URL är satt." };
}

/** Återställer till det versionshanterade utgångsläget. */
export async function resetDocument(updatedBy: string): Promise<LibraryDocument> {
  const seed = await readSeed();
  const fresh: LibraryDocument = JSON.parse(JSON.stringify(seed));
  await writeDocument(fresh, updatedBy);
  memoryDoc = postgresConfigured() ? memoryDoc : null;
  return fresh;
}

export async function storeStatus(): Promise<StoreStatus> {
  const doc = await readDocument();
  const usingPostgres = postgresConfigured() && !degradedReason;
  return {
    mode: usingPostgres ? "postgres" : "memory",
    persistent: usingPostgres,
    seedSource,
    updatedAt: doc.updatedAt ?? null,
    updatedBy: doc.updatedBy ?? null,
    degradedReason,
  };
}


/* ── Användare ─────────────────────────────────────────────────────────── */

type UserRow = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: string;
  password_hash: string;
  salt: string;
  created_at: Date;
};

function fromRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    role: (row.role === "admin" || row.role === "sales" ? row.role : "customer") as
      StoredUser["role"],
    passwordHash: row.password_hash,
    salt: row.salt,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  const key = email.trim().toLowerCase();

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      const result = await pool.query<UserRow>("SELECT * FROM app_user WHERE email = $1", [key]);
      degradedReason = null;
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  return memoryUsers.get(key) ?? null;
}

export async function findUserById(id: string): Promise<StoredUser | null> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      const result = await pool.query<UserRow>("SELECT * FROM app_user WHERE id = $1", [id]);
      degradedReason = null;
      return result.rows[0] ? fromRow(result.rows[0]) : null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  for (const user of memoryUsers.values()) if (user.id === id) return user;
  return null;
}

export async function insertUser(user: StoredUser): Promise<void> {
  const key = user.email.trim().toLowerCase();

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO app_user (id, email, name, company, role, password_hash, salt)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user.id, key, user.name, user.company, user.role, user.passwordHash, user.salt],
      );
      degradedReason = null;
      return;
    } catch (error) {
      // Ett unikhetsfel ska bubbla upp; bara anslutningsfel faller tillbaka.
      const message = error instanceof Error ? error.message : "";
      if (message.includes("duplicate key")) throw new Error("E-postadressen är redan registrerad.");
      degradedReason = message || "Okänt databasfel.";
      poolPromise = null;
    }
  }

  if (memoryUsers.has(key)) throw new Error("E-postadressen är redan registrerad.");
  memoryUsers.set(key, { ...user, email: key });
}

export async function listUsers(): Promise<StoredUser[]> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      const result = await pool.query<UserRow>("SELECT * FROM app_user ORDER BY created_at");
      degradedReason = null;
      return result.rows.map(fromRow);
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }
  return [...memoryUsers.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateUserRole(id: string, role: StoredUser["role"]): Promise<void> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await pool.query("UPDATE app_user SET role = $2 WHERE id = $1", [id, role]);
      degradedReason = null;
      return;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }
  for (const [key, user] of memoryUsers) {
    if (user.id === id) memoryUsers.set(key, { ...user, role });
  }
}

export async function deleteUser(id: string): Promise<void> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await pool.query("DELETE FROM app_user WHERE id = $1", [id]);
      degradedReason = null;
      return;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }
  for (const [key, user] of memoryUsers) if (user.id === id) memoryUsers.delete(key);
}

export async function countUsers(): Promise<number> {
  return (await listUsers()).length;
}
