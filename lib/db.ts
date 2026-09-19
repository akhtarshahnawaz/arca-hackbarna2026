import { createClient, type Client } from "@libsql/client";
import { isProtectiveAction, type ProtectiveAction } from "./protective-action.ts";

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
  `CREATE TABLE IF NOT EXISTS slng_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ok INTEGER NOT NULL,
    fallback INTEGER NOT NULL DEFAULT 0,
    cost TEXT,
    quality TEXT,
    detail TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS voice_calls (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    to_number TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    vonage_uuid TEXT,
    audio_id TEXT,
    dtmf_audio_id TEXT,
    transcript TEXT,
    empty_hangup INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    telegram_followup INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS protective_actions (
    site_id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    decided_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS voice_call_keeps (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    to_last4 TEXT NOT NULL,
    status TEXT NOT NULL,
    transcript TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL,
    archived_at TEXT NOT NULL
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
    "ALTER TABLE confirmations ADD COLUMN channel TEXT",
    "ALTER TABLE confirmations ADD COLUMN transcript TEXT",
    "ALTER TABLE confirmations ADD COLUMN self_corrected INTEGER",
    "ALTER TABLE confirmations ADD COLUMN discarded_count INTEGER",
    "ALTER TABLE confirmations ADD COLUMN correction_copy TEXT",
    "ALTER TABLE residents ADD COLUMN opted_in INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE voice_calls ADD COLUMN outcome TEXT",
    "ALTER TABLE voice_calls ADD COLUMN next_retry_at TEXT",
    "ALTER TABLE voice_calls ADD COLUMN coordinator_number TEXT",
    "ALTER TABLE voice_calls ADD COLUMN self_corrected INTEGER",
    "ALTER TABLE voice_calls ADD COLUMN discarded_count INTEGER",
    "ALTER TABLE voice_calls ADD COLUMN correction_copy TEXT",
    "ALTER TABLE voice_calls ADD COLUMN spare_time REAL",
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
  channel?: "phone" | "telegram" | "console" | null;
  transcript?: string | null;
  selfCorrected?: boolean | null;
  discardedCount?: number | null;
  correctionCopy?: string | null;
}): Promise<{ reportedAt: string; source: "reported" }> {
  const db = await ensureArcaSchema();
  const reportedAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO confirmations (site_id, species, count, source, reported_at, has_transport, channel, transcript, self_corrected, discarded_count, correction_copy)
          VALUES (?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?, ?)`,
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
      input.channel ?? "console",
      input.transcript ?? null,
      input.selfCorrected ? 1 : 0,
      input.discardedCount ?? null,
      input.correctionCopy ?? null,
    ],
  });
  return { reportedAt, source: "reported" };
}

export async function listLatestConfirmations() {
  const db = await ensureArcaSchema();
  const result = await db.execute(
    `SELECT site_id, species, count, source, reported_at, has_transport, channel, transcript, self_corrected, discarded_count, correction_copy
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
    channel:
      row.channel === "phone" || row.channel === "telegram" || row.channel === "console"
        ? row.channel
        : "console",
    transcript: row.transcript == null ? null : String(row.transcript),
    selfCorrected: Number(row.self_corrected) === 1,
    discardedCount:
      row.discarded_count === null || row.discarded_count === undefined
        ? null
        : Number(row.discarded_count),
    correctionCopy: row.correction_copy == null ? null : String(row.correction_copy),
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

export async function saveSlngLog(log: {
  started_at: string;
  latency_ms: number;
  kind: string;
  ok: boolean;
  fallback?: boolean;
  cost?: string;
  quality?: string;
  detail: string;
}): Promise<void> {
  const db = await ensureArcaSchema();
  await db.execute({
    sql: `INSERT INTO slng_logs (started_at, latency_ms, kind, ok, fallback, cost, quality, detail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      log.started_at,
      log.latency_ms,
      log.kind,
      log.ok ? 1 : 0,
      log.fallback ? 1 : 0,
      log.cost ?? null,
      log.quality ?? null,
      log.detail,
    ],
  });
}

export type VoiceCallRow = {
  id: string;
  siteId: string;
  toNumber: string;
  status: string;
  attempt: number;
  vonageUuid: string | null;
  audioId: string | null;
  dtmfAudioId: string | null;
  transcript: string | null;
  emptyHangup: boolean;
  flagged: boolean;
  telegramFollowup: boolean;
  outcome: string | null;
  nextRetryAt: string | null;
  coordinatorNumber: string | null;
  selfCorrected: boolean;
  discardedCount: number | null;
  correctionCopy: string | null;
  spareTime: number | null;
  createdAt: string;
  updatedAt: string;
};

function mapVoiceCall(row: Record<string, unknown>): VoiceCallRow {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    toNumber: String(row.to_number),
    status: String(row.status),
    attempt: Number(row.attempt) || 0,
    vonageUuid: row.vonage_uuid == null ? null : String(row.vonage_uuid),
    audioId: row.audio_id == null ? null : String(row.audio_id),
    dtmfAudioId: row.dtmf_audio_id == null ? null : String(row.dtmf_audio_id),
    transcript: row.transcript == null ? null : String(row.transcript),
    emptyHangup: Number(row.empty_hangup) === 1,
    flagged: Number(row.flagged) === 1,
    telegramFollowup: Number(row.telegram_followup) === 1,
    outcome: row.outcome == null ? null : String(row.outcome),
    nextRetryAt: row.next_retry_at == null ? null : String(row.next_retry_at),
    coordinatorNumber: row.coordinator_number == null ? null : String(row.coordinator_number),
    selfCorrected: Number(row.self_corrected) === 1,
    discardedCount:
      row.discarded_count === null || row.discarded_count === undefined
        ? null
        : Number(row.discarded_count),
    correctionCopy: row.correction_copy == null ? null : String(row.correction_copy),
    spareTime:
      row.spare_time === null || row.spare_time === undefined ? null : Number(row.spare_time),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function insertVoiceCall(input: {
  id: string;
  siteId: string;
  toNumber: string;
  status: string;
  attempt?: number;
  coordinatorNumber?: string | null;
  spareTime?: number | null;
}): Promise<VoiceCallRow> {
  const db = await ensureArcaSchema();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO voice_calls (id, site_id, to_number, status, attempt, coordinator_number, spare_time, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.id,
      input.siteId,
      input.toNumber,
      input.status,
      input.attempt ?? 0,
      input.coordinatorNumber ?? null,
      input.spareTime ?? null,
      now,
      now,
    ],
  });
  const row = await getVoiceCall(input.id);
  if (!row) throw new Error("voice call insert failed");
  return row;
}

export async function getVoiceCall(id: string): Promise<VoiceCallRow | null> {
  const db = await ensureArcaSchema();
  const result = await db.execute({
    sql: `SELECT * FROM voice_calls WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  return row ? mapVoiceCall(row as Record<string, unknown>) : null;
}

export async function updateVoiceCall(
  id: string,
  patch: Partial<{
    status: string;
    attempt: number;
    vonageUuid: string | null;
    audioId: string | null;
    dtmfAudioId: string | null;
    transcript: string | null;
    emptyHangup: boolean;
    flagged: boolean;
    telegramFollowup: boolean;
    outcome: string | null;
    nextRetryAt: string | null;
    coordinatorNumber: string | null;
    selfCorrected: boolean;
    discardedCount: number | null;
    correctionCopy: string | null;
    spareTime: number | null;
  }>,
): Promise<VoiceCallRow | null> {
  const current = await getVoiceCall(id);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const db = await ensureArcaSchema();
  await db.execute({
    sql: `UPDATE voice_calls
          SET status = ?, attempt = ?, vonage_uuid = ?, audio_id = ?, dtmf_audio_id = ?,
              transcript = ?, empty_hangup = ?, flagged = ?, telegram_followup = ?,
              outcome = ?, next_retry_at = ?, coordinator_number = ?, self_corrected = ?,
              discarded_count = ?, correction_copy = ?, spare_time = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      next.status,
      next.attempt,
      next.vonageUuid,
      next.audioId,
      next.dtmfAudioId,
      next.transcript,
      next.emptyHangup ? 1 : 0,
      next.flagged ? 1 : 0,
      next.telegramFollowup ? 1 : 0,
      next.outcome,
      next.nextRetryAt,
      next.coordinatorNumber,
      next.selfCorrected ? 1 : 0,
      next.discardedCount,
      next.correctionCopy,
      next.spareTime,
      next.updatedAt,
      id,
    ],
  });
  return getVoiceCall(id);
}

export async function listDueVoiceRetries(nowIso = new Date().toISOString()): Promise<VoiceCallRow[]> {
  const db = await ensureArcaSchema();
  const result = await db.execute({
    sql: `SELECT * FROM voice_calls
          WHERE next_retry_at IS NOT NULL AND next_retry_at <= ? AND status NOT IN ('confirmed', 'denied', 'hung_up', 'unreachable')
          ORDER BY next_retry_at ASC`,
    args: [nowIso],
  });
  return result.rows.map((row) => mapVoiceCall(row as Record<string, unknown>));
}

export async function listVoiceCalls(limit = 40): Promise<VoiceCallRow[]> {
  const db = await ensureArcaSchema();
  const result = await db.execute({
    sql: `SELECT * FROM voice_calls ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map((row) => mapVoiceCall(row as Record<string, unknown>));
}

export async function saveProtectiveAction(input: {
  siteId: string;
  action: ProtectiveAction;
}): Promise<void> {
  const db = await ensureArcaSchema();
  await db.execute({
    sql: `INSERT INTO protective_actions (site_id, action, decided_at)
          VALUES (?, ?, ?)
          ON CONFLICT(site_id) DO UPDATE SET
            action = excluded.action,
            decided_at = excluded.decided_at`,
    args: [input.siteId, input.action, new Date().toISOString()],
  });
}

export async function listProtectiveActions(): Promise<Map<string, ProtectiveAction>> {
  const db = await ensureArcaSchema();
  const result = await db.execute(`SELECT site_id, action FROM protective_actions`);
  const actions = new Map<string, ProtectiveAction>();
  for (const row of result.rows) {
    const siteId = String(row.site_id ?? "");
    const action = row.action;
    if (siteId && isProtectiveAction(action)) actions.set(siteId, action);
  }
  return actions;
}

export async function resetArcaConnection(): Promise<void> {
  if (client) {
    try {
      client.close();
    } catch {
      // Test helper — ignore a close on a client that is already gone.
    }
  }
  client = null;
  schemaReady = false;
}

export async function archiveVoiceEvidence(rows: VoiceCallRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await ensureArcaSchema();
  const archivedAt = new Date().toISOString();
  for (const row of rows) {
    const digits = row.toNumber.replace(/\D/g, "");
    const last4 = digits.slice(-4) || "????";
    await db.execute({
      sql: `INSERT INTO voice_call_keeps (id, site_id, to_last4, status, transcript, outcome, created_at, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              transcript = excluded.transcript,
              status = excluded.status,
              outcome = excluded.outcome,
              archived_at = excluded.archived_at`,
      args: [
        row.id,
        row.siteId,
        last4,
        row.status,
        row.transcript,
        row.outcome,
        row.createdAt,
        archivedAt,
      ],
    });
  }
  return rows.length;
}

export async function wipeDemoRuntimeTables(): Promise<void> {
  const db = await ensureArcaSchema();
  await db.batch(
    [
      "DELETE FROM protective_actions",
      "DELETE FROM confirmations",
      "DELETE FROM alert_requests",
      "DELETE FROM residents",
      "DELETE FROM voice_calls",
    ],
    "write",
  );
}

export async function countTable(
  table: "slng_logs" | "simulations" | "protective_actions" | "voice_calls" | "residents" | "confirmations",
): Promise<number> {
  const db = await ensureArcaSchema();
  const result = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(result.rows[0]?.n ?? 0);
}
