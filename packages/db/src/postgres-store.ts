import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  Incident,
  RankedSite,
  RankingDiff,
  SiteReport,
  SiteStatus,
  TimelineEvent,
} from "@arca/core";
import * as schema from "./schema.js";
import type {
  CallRecord,
  DecisionRecord,
  ExposureRecord,
  SiteRecord,
  SpreadRunRecord,
  Store,
} from "./store.js";

/**
 * Postgres-backed store.
 *
 * Mirrors MemoryStore exactly, including the two behaviours that are easy to
 * lose in SQL: a re-rank preserves the status and phone report a coordinator
 * established, and the "latest" spread run prefers a completed one over a newer
 * failure. A store that quietly dropped either would look fine in a smoke test
 * and lose the operator's work during an incident.
 */
export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private sql: ReturnType<typeof postgres>;
  private db: PostgresJsDatabase<typeof schema>;

  constructor(connectionString: string, options: { max?: number } = {}) {
    this.sql = postgres(connectionString, {
      max: options.max ?? 5,
      onnotice: () => {},
      // Railway's Postgres terminates idle connections; a short lifetime keeps
      // the pool from handing out sockets the server has already closed.
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    });
    this.db = drizzle(this.sql, { schema });
  }

  async init(): Promise<void> {
    await this.sql`select 1`;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  // -------------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------------

  async upsertIncident(incident: Incident): Promise<void> {
    const row = {
      id: incident.id,
      clusterId: incident.clusterId,
      name: incident.name,
      status: incident.status,
      replay: incident.replay,
      lon: incident.position[0],
      lat: incident.position[1],
      firstObserved: new Date(incident.firstObserved),
      lastObserved: new Date(incident.lastObserved),
      confirmationScore: incident.confirmation.score,
      confirmation: incident.confirmation,
      weather: incident.weather,
      updatedAt: new Date(),
    };
    await this.db
      .insert(schema.incidents)
      .values(row)
      .onConflictDoUpdate({ target: schema.incidents.clusterId, set: row });
  }

  private toIncident(row: typeof schema.incidents.$inferSelect): Incident {
    return {
      id: row.id,
      clusterId: row.clusterId,
      name: row.name,
      status: row.status as Incident["status"],
      replay: row.replay,
      position: [row.lon, row.lat],
      firstObserved: row.firstObserved.toISOString(),
      lastObserved: row.lastObserved.toISOString(),
      confirmation: row.confirmation as Incident["confirmation"],
      weather: (row.weather as Incident["weather"]) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getIncident(id: string): Promise<Incident | null> {
    const [row] = await this.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, id))
      .limit(1);
    return row ? this.toIncident(row) : null;
  }

  async getIncidentByCluster(clusterId: string): Promise<Incident | null> {
    const [row] = await this.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.clusterId, clusterId))
      .limit(1);
    return row ? this.toIncident(row) : null;
  }

  async listIncidents(filter: { status?: string[]; replay?: boolean } = {}): Promise<Incident[]> {
    const conditions = [];
    if (filter.status?.length) conditions.push(inArray(schema.incidents.status, filter.status));
    if (filter.replay !== undefined) conditions.push(eq(schema.incidents.replay, filter.replay));
    const rows = await this.db
      .select()
      .from(schema.incidents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.incidents.lastObserved));
    return rows.map((row) => this.toIncident(row));
  }

  async deleteIncident(id: string): Promise<void> {
    await Promise.all([
      this.db.delete(schema.hotspots).where(eq(schema.hotspots.incidentId, id)),
      this.db.delete(schema.spreadRuns).where(eq(schema.spreadRuns.incidentId, id)),
      this.db.delete(schema.exposures).where(eq(schema.exposures.incidentId, id)),
      this.db.delete(schema.sites).where(eq(schema.sites.incidentId, id)),
      this.db.delete(schema.decisions).where(eq(schema.decisions.incidentId, id)),
      this.db.delete(schema.calls).where(eq(schema.calls.incidentId, id)),
      this.db.delete(schema.timeline).where(eq(schema.timeline.incidentId, id)),
      this.db.delete(schema.rankingDiffs).where(eq(schema.rankingDiffs.incidentId, id)),
    ]);
    await this.db.delete(schema.incidents).where(eq(schema.incidents.id, id));
  }

  // -------------------------------------------------------------------------
  // Detections and model runs
  // -------------------------------------------------------------------------

  async saveHotspots(incidentId: string, hotspots: unknown[]): Promise<void> {
    await this.db.delete(schema.hotspots).where(eq(schema.hotspots.incidentId, incidentId));
    if (hotspots.length === 0) return;
    const rows = (hotspots as Array<Record<string, unknown>>).map((h) => ({
      id: String(h.id),
      incidentId,
      lon: (h.position as [number, number])[0],
      lat: (h.position as [number, number])[1],
      observedAt: new Date(String(h.observedAt)),
      source: String(h.source),
      sensorClass: String(h.sensorClass ?? "unknown"),
      confidence: String(h.confidence),
      frpMw: (h.fireRadiativePowerMw as number | null) ?? null,
      country: (h.country as string | null) ?? null,
      active: Boolean(h.active),
      flags: (h.flags as string[]) ?? [],
      reason: (h.reason as string | null) ?? null,
      staticSourceName: (h.staticSourceName as string | null) ?? null,
      usable: Boolean(h.usable),
    }));
    // Chunked: a large fire can carry tens of thousands of detections and a
    // single statement with that many bind parameters is rejected outright.
    for (let i = 0; i < rows.length; i += 500) {
      await this.db.insert(schema.hotspots).values(rows.slice(i, i + 500));
    }
  }

  async getHotspots(incidentId: string): Promise<unknown[]> {
    const rows = await this.db
      .select()
      .from(schema.hotspots)
      .where(eq(schema.hotspots.incidentId, incidentId))
      .orderBy(asc(schema.hotspots.observedAt));
    return rows.map((row) => ({
      id: row.id,
      clusterId: null,
      position: [row.lon, row.lat] as [number, number],
      observedAt: row.observedAt.toISOString(),
      source: row.source,
      sensorClass: row.sensorClass,
      confidence: row.confidence,
      fireRadiativePowerMw: row.frpMw,
      country: row.country,
      active: row.active,
      flags: row.flags,
      reason: row.reason,
      staticSourceName: row.staticSourceName,
      staticSourceType: null,
      usable: row.usable,
    }));
  }

  async saveSpreadRun(run: SpreadRunRecord): Promise<void> {
    const row = {
      id: run.id,
      incidentId: run.incidentId,
      simulationId: run.simulationId,
      status: run.status,
      params: run.params,
      result: run.result,
      bands: run.bands,
      frames: run.frames,
      windSpeedMs: run.windSpeedMs ?? null,
      windDirectionDeg: run.windDirectionDeg ?? null,
      burnedAreaM2: run.burnedAreaM2 ?? null,
      ensembleMembers: run.ensembleMembers ?? null,
      errorMessage: run.errorMessage ?? null,
      requestedAt: new Date(run.requestedAt),
      completedAt: run.completedAt ? new Date(run.completedAt) : null,
    };
    await this.db
      .insert(schema.spreadRuns)
      .values(row)
      .onConflictDoUpdate({ target: schema.spreadRuns.id, set: row });
  }

  async latestSpreadRun(incidentId: string): Promise<SpreadRunRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.spreadRuns)
      .where(eq(schema.spreadRuns.incidentId, incidentId))
      .orderBy(desc(schema.spreadRuns.requestedAt));
    const completed = rows.filter((r) => r.status === "COMPLETED");
    const row = (completed.length > 0 ? completed : rows)[0];
    if (!row) return null;
    return {
      id: row.id,
      incidentId: row.incidentId,
      simulationId: row.simulationId,
      status: row.status,
      params: row.params,
      result: row.result,
      bands: row.bands,
      frames: row.frames,
      windSpeedMs: row.windSpeedMs,
      windDirectionDeg: row.windDirectionDeg,
      burnedAreaM2: row.burnedAreaM2,
      ensembleMembers: row.ensembleMembers,
      errorMessage: row.errorMessage,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  async saveExposure(record: ExposureRecord): Promise<void> {
    await this.db.insert(schema.exposures).values({
      id: record.id,
      incidentId: record.incidentId,
      spreadRunId: record.spreadRunId,
      summary: record.summary,
      bands: record.bands,
      population: record.population,
      warnings: record.warnings,
      degraded: record.degraded,
      timing: record.timing,
      createdAt: new Date(record.createdAt),
    });
  }

  async latestExposure(incidentId: string): Promise<ExposureRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.exposures)
      .where(eq(schema.exposures.incidentId, incidentId))
      .orderBy(desc(schema.exposures.createdAt))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      incidentId: row.incidentId,
      spreadRunId: row.spreadRunId,
      summary: row.summary,
      bands: row.bands,
      population: row.population,
      warnings: row.warnings,
      degraded: row.degraded,
      timing: row.timing,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Sites
  // -------------------------------------------------------------------------

  async saveSites(incidentId: string, sites: SiteRecord[]): Promise<void> {
    if (sites.length === 0) return;
    const existing = await this.getSites(incidentId);
    const byAsset = new Map(existing.map((s) => [s.assetId, s]));

    const rows = sites.map((site) => {
      const previous = byAsset.get(site.assetId);
      return {
        id: site.id,
        incidentId,
        assetId: site.assetId,
        rankingVersion: site.rankingVersion,
        payload: site.payload as unknown,
        // Coordinator workflow state survives a re-rank; the ranking pass owns
        // rank and action, never status or what a site said on the phone.
        status:
          previous?.status && previous.status !== "unnotified" ? previous.status : site.status,
        reported: (site.reported ?? previous?.reported ?? null) as unknown,
        rank: site.rank,
        action: site.action,
        spareMinutes: site.spareMinutes ?? null,
        updatedAt: new Date(),
      };
    });

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await this.db
        .insert(schema.sites)
        .values(chunk)
        .onConflictDoUpdate({
          target: [schema.sites.incidentId, schema.sites.assetId],
          set: {
            rankingVersion: sql`excluded.ranking_version`,
            payload: sql`excluded.payload`,
            status: sql`excluded.status`,
            reported: sql`excluded.reported`,
            rank: sql`excluded.rank`,
            action: sql`excluded.action`,
            spareMinutes: sql`excluded.spare_minutes`,
            updatedAt: new Date(),
          },
        });
    }
  }

  private toSite(row: typeof schema.sites.$inferSelect): SiteRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      assetId: row.assetId,
      rankingVersion: row.rankingVersion,
      payload: row.payload as RankedSite,
      status: row.status as SiteStatus,
      reported: (row.reported as SiteReport | null) ?? null,
      rank: row.rank,
      action: row.action,
      spareMinutes: row.spareMinutes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getSites(incidentId: string): Promise<SiteRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.incidentId, incidentId))
      .orderBy(asc(schema.sites.rank));
    return rows.map((row) => this.toSite(row));
  }

  async getSite(incidentId: string, assetId: string): Promise<SiteRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.sites)
      .where(and(eq(schema.sites.incidentId, incidentId), eq(schema.sites.assetId, assetId)))
      .limit(1);
    return row ? this.toSite(row) : null;
  }

  async updateSiteStatus(incidentId: string, assetId: string, status: SiteStatus): Promise<void> {
    await this.db
      .update(schema.sites)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schema.sites.incidentId, incidentId), eq(schema.sites.assetId, assetId)));
  }

  async setSiteReport(incidentId: string, assetId: string, report: SiteReport): Promise<void> {
    await this.db
      .update(schema.sites)
      .set({ reported: report, status: "reported", updatedAt: new Date() })
      .where(and(eq(schema.sites.incidentId, incidentId), eq(schema.sites.assetId, assetId)));
  }

  // -------------------------------------------------------------------------
  // Decisions, calls, timeline
  // -------------------------------------------------------------------------

  async addDecision(decision: DecisionRecord): Promise<void> {
    await this.db.insert(schema.decisions).values({
      id: decision.id,
      incidentId: decision.incidentId,
      siteId: decision.siteId,
      kind: decision.kind,
      actor: decision.actor,
      via: decision.via,
      note: decision.note ?? null,
      payload: decision.payload,
      at: new Date(decision.at),
    });
  }

  async listDecisions(incidentId: string): Promise<DecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.incidentId, incidentId))
      .orderBy(asc(schema.decisions.at));
    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      siteId: row.siteId,
      kind: row.kind as DecisionRecord["kind"],
      actor: row.actor,
      via: row.via as DecisionRecord["via"],
      note: row.note,
      payload: row.payload,
      at: row.at.toISOString(),
    }));
  }

  async saveCall(call: CallRecord): Promise<void> {
    await this.db.insert(schema.calls).values({
      id: call.id,
      incidentId: call.incidentId,
      siteId: call.siteId,
      provider: call.provider,
      providerCallId: call.providerCallId,
      phoneMasked: call.phoneMasked,
      status: call.status,
      mode: call.mode,
      webSessionUrl: call.webSessionUrl ?? null,
      transcript: call.transcript ?? null,
      extracted: call.extracted,
      extractionModel: call.extractionModel ?? null,
      error: call.error ?? null,
      dispatchedAt: new Date(call.dispatchedAt),
      endedAt: call.endedAt ? new Date(call.endedAt) : null,
      latency: call.latency,
    });
  }

  async updateCall(id: string, patch: Partial<CallRecord>): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.providerCallId !== undefined) set.providerCallId = patch.providerCallId;
    if (patch.transcript !== undefined) set.transcript = patch.transcript;
    if (patch.extracted !== undefined) set.extracted = patch.extracted;
    if (patch.extractionModel !== undefined) set.extractionModel = patch.extractionModel;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.webSessionUrl !== undefined) set.webSessionUrl = patch.webSessionUrl;
    if (patch.latency !== undefined) set.latency = patch.latency;
    if (patch.endedAt !== undefined) set.endedAt = patch.endedAt ? new Date(patch.endedAt) : null;
    if (Object.keys(set).length === 0) return;
    await this.db.update(schema.calls).set(set).where(eq(schema.calls.id, id));
  }

  private toCall(row: typeof schema.calls.$inferSelect): CallRecord {
    return {
      id: row.id,
      incidentId: row.incidentId,
      siteId: row.siteId,
      provider: row.provider,
      providerCallId: row.providerCallId,
      phoneMasked: row.phoneMasked,
      status: row.status as CallRecord["status"],
      mode: row.mode as CallRecord["mode"],
      webSessionUrl: row.webSessionUrl,
      transcript: row.transcript,
      extracted: (row.extracted as SiteReport | null) ?? null,
      extractionModel: row.extractionModel,
      error: row.error,
      dispatchedAt: row.dispatchedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      latency: row.latency,
    };
  }

  async getCall(id: string): Promise<CallRecord | null> {
    const [row] = await this.db.select().from(schema.calls).where(eq(schema.calls.id, id)).limit(1);
    return row ? this.toCall(row) : null;
  }

  async listCalls(incidentId: string): Promise<CallRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.incidentId, incidentId))
      .orderBy(desc(schema.calls.dispatchedAt));
    return rows.map((row) => this.toCall(row));
  }

  async listOpenCalls(): Promise<CallRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(inArray(schema.calls.status, ["dispatched", "ringing", "answered", "web_session"]));
    return rows.map((row) => this.toCall(row));
  }

  async addTimelineEvent(event: TimelineEvent): Promise<void> {
    await this.db.insert(schema.timeline).values({
      id: event.id,
      incidentId: event.incidentId,
      at: new Date(event.at),
      kind: event.kind,
      actor: event.actor,
      message: event.message,
      data: event.data,
    });
  }

  async getTimeline(incidentId: string, limit = 200): Promise<TimelineEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.timeline)
      .where(eq(schema.timeline.incidentId, incidentId))
      .orderBy(desc(schema.timeline.at))
      .limit(limit);
    return rows
      .map((row) => ({
        id: row.id,
        incidentId: row.incidentId,
        at: row.at.toISOString(),
        kind: row.kind as TimelineEvent["kind"],
        actor: row.actor,
        message: row.message,
        data: (row.data as Record<string, unknown> | null) ?? null,
      }))
      .reverse();
  }

  async saveRankingDiff(incidentId: string, diff: RankingDiff): Promise<void> {
    await this.db.insert(schema.rankingDiffs).values({
      id: `${incidentId}:${diff.fromVersion}:${diff.toVersion}:${Date.now()}`,
      incidentId,
      fromVersion: diff.fromVersion,
      toVersion: diff.toVersion,
      entries: diff.entries,
      summary: diff.summary,
      at: new Date(),
    });
  }

  async listRankingDiffs(incidentId: string): Promise<Array<RankingDiff & { at: string }>> {
    const rows = await this.db
      .select()
      .from(schema.rankingDiffs)
      .where(eq(schema.rankingDiffs.incidentId, incidentId))
      .orderBy(asc(schema.rankingDiffs.at));
    return rows.map((row) => ({
      fromVersion: row.fromVersion,
      toVersion: row.toVersion,
      entries: (row.entries as RankingDiff["entries"]) ?? [],
      summary: row.summary,
      at: row.at.toISOString(),
    }));
  }

  async getKv<T>(key: string): Promise<T | null> {
    const [row] = await this.db.select().from(schema.kv).where(eq(schema.kv.key, key)).limit(1);
    return (row?.value as T) ?? null;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    await this.db
      .insert(schema.kv)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.kv.key, set: { value, updatedAt: new Date() } });
  }
}
