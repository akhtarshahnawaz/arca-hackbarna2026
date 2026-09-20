import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Durable state for ARCA.
 *
 * Deliberately not a spatial database. Every spatial decision — masking,
 * band construction, point-in-polygon, ranking — happens in `@arca/core`
 * against geometry held in memory for the few minutes an incident is live, or
 * inside Talaia, which already has an R-tree and a Rust core for exactly this.
 * Adding PostGIS would duplicate that machinery, pin the deployment to a
 * specific Postgres image, and buy nothing: ARCA never asks the database a
 * spatial question. Geometry is stored as JSONB because it is a value to hand
 * back, not something to query on.
 */

export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    clusterId: text("cluster_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("candidate"),
    replay: boolean("replay").notNull().default(false),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    firstObserved: timestamp("first_observed", { withTimezone: true }).notNull(),
    lastObserved: timestamp("last_observed", { withTimezone: true }).notNull(),
    confirmationScore: integer("confirmation_score").notNull().default(0),
    confirmation: jsonb("confirmation").$type<unknown>(),
    weather: jsonb("weather").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One open incident per cluster. The watcher runs every few minutes and
    // must be able to upsert without ever forking a second incident for a fire
    // it has already opened.
    clusterIdx: uniqueIndex("incidents_cluster_idx").on(table.clusterId),
    statusIdx: index("incidents_status_idx").on(table.status),
  }),
);

export const hotspots = pgTable(
  "hotspots",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    sensorClass: text("sensor_class").notNull(),
    confidence: text("confidence").notNull(),
    frpMw: doublePrecision("frp_mw"),
    country: text("country"),
    active: boolean("active").notNull().default(true),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    reason: text("reason"),
    staticSourceName: text("static_source_name"),
    usable: boolean("usable").notNull().default(true),
  },
  (table) => ({
    incidentIdx: index("hotspots_incident_idx").on(table.incidentId),
    observedIdx: index("hotspots_observed_idx").on(table.observedAt),
  }),
);

export const spreadRuns = pgTable(
  "spread_runs",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    simulationId: text("simulation_id"),
    status: text("status").notNull(),
    params: jsonb("params").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    bands: jsonb("bands").$type<unknown>(),
    frames: jsonb("frames").$type<unknown>(),
    windSpeedMs: doublePrecision("wind_speed_ms"),
    windDirectionDeg: doublePrecision("wind_direction_deg"),
    burnedAreaM2: doublePrecision("burned_area_m2"),
    ensembleMembers: integer("ensemble_members"),
    errorMessage: text("error_message"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({ incidentIdx: index("spread_runs_incident_idx").on(table.incidentId) }),
);

export const exposures = pgTable(
  "exposures",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    spreadRunId: text("spread_run_id"),
    summary: jsonb("summary").$type<unknown>(),
    bands: jsonb("bands").$type<unknown>(),
    population: jsonb("population").$type<unknown>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    degraded: jsonb("degraded").$type<unknown>(),
    timing: jsonb("timing").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ incidentIdx: index("exposures_incident_idx").on(table.incidentId) }),
);

export const sites = pgTable(
  "sites",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    assetId: text("asset_id").notNull(),
    rankingVersion: integer("ranking_version").notNull().default(1),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").notNull().default("unnotified"),
    reported: jsonb("reported").$type<unknown>(),
    rank: integer("rank").notNull().default(0),
    action: text("action").notNull(),
    spareMinutes: doublePrecision("spare_minutes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    incidentIdx: index("sites_incident_idx").on(table.incidentId),
    // A site is identified by its Talaia asset within an incident, so a
    // re-rank updates rows rather than accumulating a new set every few
    // minutes — otherwise a long incident would silently grow without bound.
    assetIdx: uniqueIndex("sites_incident_asset_idx").on(table.incidentId, table.assetId),
  }),
);

export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    siteId: text("site_id"),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    via: text("via").notNull(),
    note: text("note"),
    payload: jsonb("payload").$type<unknown>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ incidentIdx: index("decisions_incident_idx").on(table.incidentId) }),
);

export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    siteId: text("site_id").notNull(),
    provider: text("provider").notNull().default("slng"),
    providerCallId: text("provider_call_id"),
    phoneMasked: text("phone_masked").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull().default("phone"),
    webSessionUrl: text("web_session_url"),
    transcript: text("transcript"),
    extracted: jsonb("extracted").$type<unknown>(),
    extractionModel: text("extraction_model"),
    error: text("error"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    latency: jsonb("latency").$type<unknown>(),
  },
  (table) => ({
    incidentIdx: index("calls_incident_idx").on(table.incidentId),
    siteIdx: index("calls_site_idx").on(table.siteId),
  }),
);

export const timeline = pgTable(
  "timeline",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<unknown>(),
  },
  (table) => ({ incidentIdx: index("timeline_incident_idx").on(table.incidentId, table.at) }),
);

export const rankingDiffs = pgTable(
  "ranking_diffs",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id").notNull(),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version").notNull(),
    entries: jsonb("entries").$type<unknown>(),
    summary: text("summary").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ incidentIdx: index("ranking_diffs_incident_idx").on(table.incidentId) }),
);

/** Key-value for things that must outlive a restart: tokens, watermarks. */
export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
