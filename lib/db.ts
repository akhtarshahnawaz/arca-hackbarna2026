import { createClient, type Client } from "@libsql/client";

/**
 * ARCA app data on LibSQL / SQLite — same engine Mastra uses for memory.
 * Local default: DATABASE_URL=file:./arca.db (laptop file survives a reboot).
 * Many cloud hosts wipe the disk on restart. For Sunday 17:30 uptime use Turso
 * (hosted LibSQL: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) or a persistent volume
 * so residents, confirmations, and Deepfire simulation ids survive 3 AM restarts.
 * Do not seed real personal data.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS coordinators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    zone TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS residents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    lat REAL,
    lon REAL,
    animals TEXT NOT NULL DEFAULT '[]',
    has_transport INTEGER NOT NULL DEFAULT 0,
    opted_in INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS confirmations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    species TEXT NOT NULL,
    count INTEGER NOT NULL,
    source TEXT NOT NULL,
    reported_at TEXT NOT NULL,
    has_transport INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS alert_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deepfire_simulation_id TEXT NOT NULL UNIQUE,
    cluster_id TEXT,
    status TEXT NOT NULL,
    result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
] as const;

let client: Client | null = null;
let schemaReady = false;

export function getArcaDb(): Client {
  if (client) return client;
  const url = process.env.DATABASE_URL?.trim() || "file:./arca.db";
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return client;
}

export async function ensureArcaSchema(): Promise<Client> {
  const db = getArcaDb();
  if (schemaReady) return db;
  await db.batch([...SCHEMA], "write");
  await ensureOptionalColumns(db);
  schemaReady = true;
  return db;
}

async function ensureOptionalColumns(db: Client): Promise<void> {
  const extras = [
    "ALTER TABLE confirmations ADD COLUMN has_transport INTEGER",
    "ALTER TABLE residents ADD COLUMN opted_in INTEGER NOT NULL DEFAULT 1",
  ];
  for (const sql of extras) {
    try {
      await db.execute(sql);
    } catch {
      // Column already exists on older arca.db files.
    }
  }
}

export async function rememberSimulation(input: {
  deepfireSimulationId: string;
  clusterId?: string | null;
  status: string;
  result?: unknown;
}): Promise<void> {
  const db = await ensureArcaSchema();
  const resultJson =
    input.result === undefined ? null : JSON.stringify(input.result);
  await db.execute({
    sql: `INSERT INTO simulations (deepfire_simulation_id, cluster_id, status, result)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(deepfire_simulation_id) DO UPDATE SET
            cluster_id = excluded.cluster_id,
            status = excluded.status,
            result = excluded.result`,
    args: [
      input.deepfireSimulationId,
      input.clusterId ?? null,
      input.status,
      resultJson,
    ],
  });
}

export async function listRememberedSimulations(clusterId?: string) {
  const db = await ensureArcaSchema();
  const result = clusterId
    ? await db.execute({
        sql: `SELECT deepfire_simulation_id, cluster_id, status, created_at
              FROM simulations
              WHERE cluster_id = ?
              ORDER BY created_at DESC`,
        args: [clusterId],
      })
    : await db.execute(
        `SELECT deepfire_simulation_id, cluster_id, status, created_at
         FROM simulations
         ORDER BY created_at DESC`,
      );
  return result.rows;
}

export async function saveReportedConfirmation(input: {
  siteId: string;
  species: string;
  count: number;
  hasTransport?: boolean | null;
}): Promise<{ reportedAt: string; source: "reported" }> {
  const db = await ensureArcaSchema();
  const reportedAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO confirmations (site_id, species, count, source, reported_at, has_transport)
          VALUES (?, ?, ?, 'reported', ?, ?)`,
    args: [
      input.siteId.trim(),
      input.species.trim(),
      input.count,
      reportedAt,
      input.hasTransport === null || input.hasTransport === undefined
        ? null
        : input.hasTransport
          ? 1
          : 0,
    ],
  });
  return { reportedAt, source: "reported" };
}

export async function listLatestConfirmations() {
  const db = await ensureArcaSchema();
  const result = await db.execute(
    `SELECT site_id, species, count, source, reported_at, has_transport
     FROM confirmations
     ORDER BY reported_at ASC`,
  );
  return result.rows.map((row) => ({
    siteId: String(row.site_id),
    species: String(row.species),
    count: Number(row.count),
    source: row.source === "verified" ? ("verified" as const) : ("reported" as const),
    reportedAt: String(row.reported_at),
    hasTransport:
      row.has_transport === null || row.has_transport === undefined
        ? null
        : Number(row.has_transport) === 1,
  }));
}

export async function upsertResident(input: {
  telegramId: string;
  address: string;
  lat?: number | null;
  lon?: number | null;
  animals: unknown;
  hasTransport: boolean;
}): Promise<void> {
  const db = await ensureArcaSchema();
  await db.execute({
    sql: `INSERT INTO residents (telegram_id, address, lat, lon, animals, has_transport, opted_in)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(telegram_id) DO UPDATE SET
            address = excluded.address,
            lat = excluded.lat,
            lon = excluded.lon,
            animals = excluded.animals,
            has_transport = excluded.has_transport,
            opted_in = 1`,
    args: [
      input.telegramId.trim(),
      input.address.trim(),
      input.lat ?? null,
      input.lon ?? null,
      JSON.stringify(input.animals ?? []),
      input.hasTransport ? 1 : 0,
    ],
  });
}

export async function listOptedInResidents() {
  const db = await ensureArcaSchema();
  const result = await db.execute(
    `SELECT telegram_id, address, lat, lon, animals, has_transport
     FROM residents
     WHERE opted_in = 1`,
  );
  return result.rows.map((row) => ({
    telegramId: String(row.telegram_id),
    address: String(row.address),
    lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
    lon: row.lon === null || row.lon === undefined ? null : Number(row.lon),
    animals: parseAnimals(row.animals),
    hasTransport: Number(row.has_transport) === 1,
  }));
}

export async function saveAlertRequest(input: {
  zone: string;
  message: string;
  status: "pending" | "approved" | "denied" | "escalated";
}): Promise<number> {
  const db = await ensureArcaSchema();
  const createdAt = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO alert_requests (zone, message, status, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [input.zone, input.message, input.status, createdAt],
  });
  return Number(result.lastInsertRowid ?? 0);
}

function parseAnimals(value: unknown): unknown {
  if (typeof value !== "string") return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
