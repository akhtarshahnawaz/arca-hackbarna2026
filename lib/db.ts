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
    has_transport INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS confirmations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    species TEXT NOT NULL,
    count INTEGER NOT NULL,
    source TEXT NOT NULL,
    reported_at TEXT NOT NULL
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
  schemaReady = true;
  return db;
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
