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
  /** Projektloggen. Ett underlag utan sin historia är bara ett läge. */
  log: unknown[];
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
      log        jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Tabellen kan vara skapad före loggkolumnen fanns.
  await pool.query("ALTER TABLE proposal ADD COLUMN IF NOT EXISTS log jsonb NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("CREATE INDEX IF NOT EXISTS proposal_user ON proposal (user_id)");
}

type ProposalRow = {
  id: string;
  user_id: string;
  name: string;
  reference: string;
  config: unknown;
  log: unknown[] | null;
  updated_at: Date;
};

const fromProposalRow = (row: ProposalRow): StoredProposal => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  reference: row.reference,
  config: row.config,
  log: row.log ?? [],
  updatedAt: row.updated_at.toISOString(),
});

export async function saveProposal(proposal: {
  id: string;
  userId: string;
  name: string;
  reference: string;
  config: unknown;
  log?: unknown[];
}): Promise<{ persisted: boolean; reason: string | null }> {
  const stored: StoredProposal = {
    ...proposal,
    log: proposal.log ?? [],
    updatedAt: new Date().toISOString(),
  };

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureProposalTable(pool);
      await pool.query(
        `INSERT INTO proposal (id, user_id, name, reference, config, log, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE
           SET name = $3, reference = $4, config = $5, log = $6, updated_at = now()
         WHERE proposal.user_id = $2`,
        [
          stored.id,
          stored.userId,
          stored.name,
          stored.reference,
          JSON.stringify(stored.config),
          JSON.stringify(stored.log),
        ],
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


/* ── Förslag som byggs i bakgrunden ────────────────────────────────────── */

/**
 * Ett jobb: kundens underlag in, ett förslag ut, någon gång senare.
 *
 * Att läsa en ritning och bygga en linje tar minuter, inte sekunder. Att låta
 * kunden sitta och titta på en snurra under tiden är att göra väntan till
 * hennes problem. I stället köas arbetet, kunden ritar vidare för hand, och
 * jobbet säger till när det finns något att titta på.
 *
 * Jobbets id är också dess nyckel: en gäst utan konto kan hämta sitt eget
 * jobb men inte någon annans, och är kunden inloggad knyts jobbet till kontot
 * och kan bara läsas därifrån.
 */

export type DraftJobStatus = "queued" | "running" | "done" | "failed";

/**
 * Vad som faktiskt hände i jobbet.
 *
 * Blev det inget förslag är det här enda förklaringen kunden kan få: vilken
 * modell som körde, vilka verktyg som anropades, vad de svarade och varför
 * turen tog slut. Ett jobb som misslyckas tyst är värre än ett som misslyckas.
 */
export type DraftJobDetail = {
  model?: string;
  provider?: string;
  rounds?: number;
  stopReason?: string;
  steps?: { name: string; ok: boolean; error?: string; ms?: number; input?: string }[];
  /** Tiden per runda: modellens egen och verktygens. */
  timeline?: { round: number; modelMs: number; toolMs: number; tools: number }[];
  totalMs?: number;
  /** När det nuvarande steget började. Utan det syns bara jobbets totaltid. */
  stepSince?: string;
  /** Vad kunden bad om, för admins felsökning. */
  note?: string;
  fileCount?: number;
  /** Om hallen ritades med belagd skala. null när den inte ritades alls. */
  scaleVerified?: boolean | null;
};

export type StoredDraftJob = {
  id: string;
  userId: string | null;
  status: DraftJobStatus;
  /** Kundens egna ord om vad anläggningen ska göra. */
  note: string;
  fileNames: string[];
  /** Vad som pågår just nu, för den som tittar. */
  step: string;
  /** Assistentens sammanfattning när jobbet är klart. */
  summary: string;
  variants: { id: string; name: string; description: string; config: unknown }[];
  detail: DraftJobDetail;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Ett jobb som varit igång längre än så har inte överlevt en omstart —
 * arbetet lever i processen, inte i databasen.
 */
export const DRAFT_JOB_STALE_MS = 20 * 60 * 1000;

const memoryJobs = new Map<string, StoredDraftJob>();

async function ensureDraftJobTable(pool: PgPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS draft_job (
      id         text PRIMARY KEY,
      user_id    text,
      status     text NOT NULL,
      note       text NOT NULL DEFAULT '',
      file_names jsonb NOT NULL DEFAULT '[]'::jsonb,
      step       text NOT NULL DEFAULT '',
      summary    text NOT NULL DEFAULT '',
      variants   jsonb NOT NULL DEFAULT '[]'::jsonb,
      detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
      error      text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Tabellen kan vara skapad före detail-kolumnen fanns.
  await pool.query("ALTER TABLE draft_job ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("CREATE INDEX IF NOT EXISTS draft_job_user ON draft_job (user_id)");
}

type DraftJobRow = {
  id: string;
  user_id: string | null;
  status: DraftJobStatus;
  note: string;
  file_names: string[];
  step: string;
  summary: string;
  variants: StoredDraftJob["variants"];
  detail: DraftJobDetail | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

const fromDraftJobRow = (row: DraftJobRow): StoredDraftJob => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  note: row.note,
  fileNames: row.file_names ?? [],
  step: row.step,
  summary: row.summary,
  variants: row.variants ?? [],
  detail: row.detail ?? {},
  error: row.error,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Skriver hela jobbet. Minnet är alltid sanning; Postgres är för omstarter. */
export async function writeDraftJob(job: StoredDraftJob): Promise<void> {
  memoryJobs.set(job.id, job);

  if (!postgresConfigured()) return;
  try {
    const pool = await getPool();
    await ensureDraftJobTable(pool);
    await pool.query(
      `INSERT INTO draft_job (id, user_id, status, note, file_names, step, summary, variants, detail, error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (id) DO UPDATE
         SET status = $3, step = $6, summary = $7, variants = $8, detail = $9, error = $10,
             updated_at = now()`,
      [
        job.id,
        job.userId,
        job.status,
        job.note,
        JSON.stringify(job.fileNames),
        job.step,
        job.summary,
        JSON.stringify(job.variants),
        JSON.stringify(job.detail ?? {}),
        job.error,
      ],
    );
    degradedReason = null;
  } catch (error) {
    degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
    poolPromise = null;
  }
}

/**
 * Hämtar ett jobb. Är det knutet till ett konto måste det vara samma konto;
 * annars räcker id:t, som är hemligt.
 */
export async function readDraftJob(
  id: string,
  userId: string | null,
): Promise<StoredDraftJob | null> {
  let found = memoryJobs.get(id) ?? null;

  if (!found && postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureDraftJobTable(pool);
      const result = await pool.query<DraftJobRow>("SELECT * FROM draft_job WHERE id = $1", [id]);
      degradedReason = null;
      found = result.rows[0] ? fromDraftJobRow(result.rows[0]) : null;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  if (!found) return null;
  if (found.userId && found.userId !== userId) return null;

  // Ett jobb som ligger kvar som igång efter en omstart blir aldrig klart.
  // Att säga det är bättre än att låta kunden vänta på något som är borta.
  if (
    (found.status === "queued" || found.status === "running") &&
    Date.now() - new Date(found.updatedAt).getTime() > DRAFT_JOB_STALE_MS
  ) {
    const stale: StoredDraftJob = {
      ...found,
      status: "failed",
      error:
        "Jobbet avbröts när servern startade om. Ladda upp underlaget igen, " +
        "eller fråga assistenten direkt.",
      updatedAt: new Date().toISOString(),
    };
    await writeDraftJob(stale);
    return stale;
  }

  return found;
}

/** Kontots jobb, nyast först. */
export async function listDraftJobs(userId: string): Promise<StoredDraftJob[]> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureDraftJobTable(pool);
      const result = await pool.query<DraftJobRow>(
        "SELECT * FROM draft_job WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20",
        [userId],
      );
      degradedReason = null;
      return result.rows.map(fromDraftJobRow);
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  return [...memoryJobs.values()]
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * De senaste jobben, oavsett ägare. Bara för admin.
 *
 * Frågan "varför tog det sex minuter" går inte att svara på utan att se
 * körningarna, och de ligger utspridda på olika konton — och på inget konto
 * alls när kunden inte var inloggad.
 */
export async function listRecentDraftJobs(limit = 20): Promise<StoredDraftJob[]> {
  const rows: StoredDraftJob[] = [];

  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureDraftJobTable(pool);
      const result = await pool.query<DraftJobRow>(
        "SELECT * FROM draft_job ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
      degradedReason = null;
      rows.push(...result.rows.map(fromDraftJobRow));
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  // Minnet kan ha jobb som databasen ännu inte sett, eller vara allt som finns.
  for (const job of memoryJobs.values()) {
    if (!rows.some((row) => row.id === job.id)) rows.push(job);
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function deleteDraftJob(id: string, userId: string | null): Promise<void> {
  const found = await readDraftJob(id, userId);
  if (!found) return;
  memoryJobs.delete(id);
  if (!postgresConfigured()) return;
  try {
    const pool = await getPool();
    await ensureDraftJobTable(pool);
    await pool.query("DELETE FROM draft_job WHERE id = $1", [id]);
    degradedReason = null;
  } catch (error) {
    degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
    poolPromise = null;
  }
}


/* ── Driftinställningar ────────────────────────────────────────────────── */

/**
 * Små inställningar som admin äger: i dag vilken modell assistenten går mot.
 *
 * De hör inte hemma i biblioteksdokumentet — det är produktdata som exporteras
 * och committas — och inte i miljövariabler heller, eftersom de ska gå att
 * ändra utan en ny deploy. Nycklar är undantaget: de kommer alltid ur miljön.
 */

const memorySettings = new Map<string, unknown>();

async function ensureSettingTable(pool: PgPool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_setting (
      id         text PRIMARY KEY,
      value      jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function readSetting<T>(id: string, fallback: T): Promise<T> {
  if (postgresConfigured()) {
    try {
      const pool = await getPool();
      await ensureSettingTable(pool);
      const result = await pool.query<{ value: T }>(
        "SELECT value FROM app_setting WHERE id = $1",
        [id],
      );
      degradedReason = null;
      if (result.rows[0]) return { ...fallback, ...(result.rows[0].value as object) } as T;
      return fallback;
    } catch (error) {
      degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
      poolPromise = null;
    }
  }

  const found = memorySettings.get(id);
  return found ? ({ ...fallback, ...(found as object) } as T) : fallback;
}

export async function writeSetting<T>(
  id: string,
  value: T,
): Promise<{ persisted: boolean; reason: string | null }> {
  memorySettings.set(id, value);

  if (!postgresConfigured()) {
    return { persisted: false, reason: "Ingen DATABASE_URL är satt." };
  }
  try {
    const pool = await getPool();
    await ensureSettingTable(pool);
    await pool.query(
      `INSERT INTO app_setting (id, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE SET value = $2, updated_at = now()`,
      [id, JSON.stringify(value)],
    );
    degradedReason = null;
    return { persisted: true, reason: null };
  } catch (error) {
    degradedReason = error instanceof Error ? error.message : "Okänt databasfel.";
    poolPromise = null;
    return { persisted: false, reason: degradedReason };
  }
}
