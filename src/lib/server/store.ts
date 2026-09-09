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

/* ── 3D-modeller ───────────────────────────────────────────────────────── */

/**
 * GLB-filer lagras för sig, aldrig i biblioteksdokumentet.
 *
 * Dokumentet läses vid varje /api/library och /api/price. En maskinmodell är
 * några hundra kilobyte till några megabyte; tio sådana i dokumentet skulle
 * göra varje prisberäkning till en flerhundramegabytesläsning. Därför en egen
 * tabell, hämtad bara av /api/models/[id] när vyn Modell faktiskt öppnas.
 */

export type StoredModel = {
  id: string;
  machineId: string;
  /** Namnet på STEP-filen den kom ur. */
  name: string;
  kind: "glb" | "proxy";
  bytes: number;
  createdAt: string;
};

/** Tak för modeller i minnesläge. Äldst faller ut först. */
const MEMORY_MODEL_BUDGET = 64 * 1024 * 1024;

const memoryModels = new Map<string, { meta: StoredModel; data: Buffer }>();

function trimMemoryModels() {
  let total = 0;
  for (const entry of memoryModels.values()) total += entry.data.length;
  if (total <= MEMORY_MODEL_BUDGET) return;

  const oldest = [...memoryModels.entries()].sort((a, b) =>
    a[1].meta.createdAt.localeCompare(b[1].meta.createdAt),
  );
  for (const [id, entry] of oldest) {
    if (total <= MEMORY_MODEL_BUDGET) break;
    memoryModels.delete(id);
    total -= entry.data.length;
  }
}

async function ensureModelTable(pool: PgPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS machine_model (
      id          text PRIMARY KEY,
      machine_id  text NOT NULL,
      name        text NOT NULL DEFAULT '',
      kind        text NOT NULL DEFAULT 'glb',
      data        bytea NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

type ModelRow = {
  id: string;
  machine_id: string;
  name: string;
  kind: string;
  created_at: Date;
  bytes: string | number;
};

function modelMeta(row: ModelRow): StoredModel {
  return {
    id: row.id,
    machineId: row.machine_id,
    name: row.name,
    kind: row.kind === "proxy" ? "proxy" : "glb",
    bytes: Number(row.bytes),
    createdAt: row.created_at.toISOString(),
  };
}

export async function putModel(model: {
  id: string;
  machineId: string;
  name: string;
  kind: "glb" | "proxy";
  data: Uint8Array;
}): Promise<{ persisted: boolean; reason: string | null }> {
  const data = Buffer.from(model.data);
  const meta: StoredModel = {
    id: model.id,
    machineId: model.machineId,
    name: model.name,
    kind: model.kind,
    bytes: data.length,
    createdAt: new Date().toISOString(),
  };

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureModelTable(pool);
      await pool.query(
        `INSERT INTO machine_model (id, machine_id, name, kind, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET machine_id = $2, name = $3, kind = $4, data = $5, created_at = now()`,
        [meta.id, meta.machineId, meta.name, meta.kind, data],
      );
      degradedReason = null;
      return { persisted: true, reason: null };
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
      // Faller igenom till minnet: modellen ska gå att se nu även om den
      // inte överlever en omstart. Anroparen får veta att den inte sparades.
      memoryModels.set(meta.id, { meta, data });
      trimMemoryModels();
      return { persisted: false, reason: degradedReason };
    }
  }

  memoryModels.set(meta.id, { meta, data });
  trimMemoryModels();
  return { persisted: false, reason: "Ingen DATABASE_URL är satt." };
}

export async function readModel(id: string): Promise<{ meta: StoredModel; data: Buffer } | null> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureModelTable(pool);
      const result = await pool.query<ModelRow & { data: Buffer }>(
        `SELECT id, machine_id, name, kind, created_at, data, length(data) AS bytes
         FROM machine_model WHERE id = $1`,
        [id],
      );
      degradedReason = null;
      if (result.rows[0]) {
        return { meta: modelMeta(result.rows[0]), data: result.rows[0].data };
      }
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  return memoryModels.get(id) ?? null;
}

export async function listModels(machineId?: string): Promise<StoredModel[]> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureModelTable(pool);
      const result = machineId
        ? await pool.query<ModelRow>(
            `SELECT id, machine_id, name, kind, created_at, length(data) AS bytes
             FROM machine_model WHERE machine_id = $1 ORDER BY created_at DESC`,
            [machineId],
          )
        : await pool.query<ModelRow>(
            `SELECT id, machine_id, name, kind, created_at, length(data) AS bytes
             FROM machine_model ORDER BY created_at DESC`,
          );
      degradedReason = null;
      return result.rows.map(modelMeta);
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  return [...memoryModels.values()]
    .map((entry) => entry.meta)
    .filter((meta) => !machineId || meta.machineId === machineId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteModel(id: string): Promise<void> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureModelTable(pool);
      await pool.query("DELETE FROM machine_model WHERE id = $1", [id]);
      degradedReason = null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }
  memoryModels.delete(id);
}


/* ── Sparade förslag ───────────────────────────────────────────────────── */

/**
 * Kundens egna förslag.
 *
 * En konfiguration lever annars i webbläsaren och i delningslänken. Det
 * räcker för att skicka något vidare, men inte för att komma tillbaka till
 * det man höll på med förra veckan — och en säljare som jobbar på tre
 * varianter samtidigt behöver dem åtskilda och namngivna.
 *
 * Förslagen hör till kontot. Utan DATABASE_URL lever de bara så länge servern
 * gör det, precis som allt annat, och vyn säger det.
 */

export type StoredProposal = {
  id: string;
  userId: string;
  name: string;
  /** Underlagsnumret vid sparandet, för att känna igen det i listan. */
  reference: string;
  config: unknown;
  updatedAt: string;
};

const memoryProposals = new Map<string, StoredProposal>();

async function ensureProposalTable(pool: PgPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposal (
      id         text PRIMARY KEY,
      user_id    text NOT NULL,
      name       text NOT NULL,
      reference  text NOT NULL DEFAULT '',
      config     jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS proposal_user ON proposal (user_id)");
}

type ProposalRow = {
  id: string;
  user_id: string;
  name: string;
  reference: string;
  config: unknown;
  updated_at: Date;
};

const fromProposalRow = (row: ProposalRow): StoredProposal => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  reference: row.reference,
  config: row.config,
  updatedAt: row.updated_at.toISOString(),
});

export async function saveProposal(proposal: {
  id: string;
  userId: string;
  name: string;
  reference: string;
  config: unknown;
}): Promise<{ persisted: boolean; reason: string | null }> {
  const stored: StoredProposal = { ...proposal, updatedAt: new Date().toISOString() };

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureProposalTable(pool);
      await pool.query(
        `INSERT INTO proposal (id, user_id, name, reference, config, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE
           SET name = $3, reference = $4, config = $5, updated_at = now()
         WHERE proposal.user_id = $2`,
        [stored.id, stored.userId, stored.name, stored.reference, JSON.stringify(stored.config)],
      );
      degradedReason = null;
      return { persisted: true, reason: null };
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
      memoryProposals.set(stored.id, stored);
      return { persisted: false, reason: degradedReason };
    }
  }

  memoryProposals.set(stored.id, stored);
  return { persisted: false, reason: "Ingen DATABASE_URL är satt." };
}

export async function listProposals(userId: string): Promise<StoredProposal[]> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureProposalTable(pool);
      const result = await pool.query<ProposalRow>(
        "SELECT * FROM proposal WHERE user_id = $1 ORDER BY updated_at DESC",
        [userId],
      );
      degradedReason = null;
      return result.rows.map(fromProposalRow);
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  return [...memoryProposals.values()]
    .filter((p) => p.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Ett förslag, men bara till den som äger det. */
export async function readProposal(id: string, userId: string): Promise<StoredProposal | null> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureProposalTable(pool);
      const result = await pool.query<ProposalRow>(
        "SELECT * FROM proposal WHERE id = $1 AND user_id = $2",
        [id, userId],
      );
      degradedReason = null;
      return result.rows[0] ? fromProposalRow(result.rows[0]) : null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  const found = memoryProposals.get(id);
  return found && found.userId === userId ? found : null;
}

export async function deleteProposal(id: string, userId: string): Promise<void> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureProposalTable(pool);
      await pool.query("DELETE FROM proposal WHERE id = $1 AND user_id = $2", [id, userId]);
      degradedReason = null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }
  const found = memoryProposals.get(id);
  if (found && found.userId === userId) memoryProposals.delete(id);
}
