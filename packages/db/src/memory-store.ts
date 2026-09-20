import type {
  Incident,
  RankingDiff,
  SiteReport,
  SiteStatus,
  TimelineEvent,
} from "@arca/core";
import type {
  CallRecord,
  DecisionRecord,
  ExposureRecord,
  SiteRecord,
  SpreadRunRecord,
  Store,
} from "./store.js";

/**
 * In-memory store.
 *
 * Not a stub. A coordinator laptop with no database still has to run the full
 * pipeline during a demo or a venue-wifi outage, and every test in the agent
 * package runs against this rather than a container. It is the reference
 * implementation of the contract; Postgres has to match its behaviour.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;

  private incidents = new Map<string, Incident>();
  private hotspots = new Map<string, unknown[]>();
  private spreadRuns = new Map<string, SpreadRunRecord[]>();
  private exposuresByIncident = new Map<string, ExposureRecord[]>();
  private sites = new Map<string, Map<string, SiteRecord>>();
  private decisions = new Map<string, DecisionRecord[]>();
  private calls = new Map<string, CallRecord>();
  private events = new Map<string, TimelineEvent[]>();
  private diffs = new Map<string, Array<RankingDiff & { at: string }>>();
  private kvStore = new Map<string, unknown>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async upsertIncident(incident: Incident): Promise<void> {
    this.incidents.set(incident.id, { ...incident });
  }

  async getIncident(id: string): Promise<Incident | null> {
    return this.incidents.get(id) ?? null;
  }

  async getIncidentByCluster(clusterId: string): Promise<Incident | null> {
    for (const incident of this.incidents.values()) {
      if (incident.clusterId === clusterId) return incident;
    }
    return null;
  }

  async listIncidents(filter: { status?: string[]; replay?: boolean } = {}): Promise<Incident[]> {
    return [...this.incidents.values()]
      .filter((i) => (filter.status ? filter.status.includes(i.status) : true))
      .filter((i) => (filter.replay === undefined ? true : i.replay === filter.replay))
      .sort((a, b) => Date.parse(b.lastObserved) - Date.parse(a.lastObserved));
  }

  async deleteIncident(id: string): Promise<void> {
    this.incidents.delete(id);
    this.hotspots.delete(id);
    this.spreadRuns.delete(id);
    this.exposuresByIncident.delete(id);
    this.sites.delete(id);
    this.decisions.delete(id);
    this.events.delete(id);
    this.diffs.delete(id);
    for (const [id_, call] of this.calls) {
      if (call.incidentId === id) this.calls.delete(id_);
    }
  }

  async saveHotspots(incidentId: string, hotspots: unknown[]): Promise<void> {
    this.hotspots.set(incidentId, hotspots);
  }

  async getHotspots(incidentId: string): Promise<unknown[]> {
    return this.hotspots.get(incidentId) ?? [];
  }

  async saveSpreadRun(run: SpreadRunRecord): Promise<void> {
    const list = this.spreadRuns.get(run.incidentId) ?? [];
    const index = list.findIndex((r) => r.id === run.id);
    if (index >= 0) list[index] = run;
    else list.push(run);
    this.spreadRuns.set(run.incidentId, list);
  }

  async latestSpreadRun(incidentId: string): Promise<SpreadRunRecord | null> {
    const list = this.spreadRuns.get(incidentId) ?? [];
    // Newest first, but a completed run always beats a newer failed one: the
    // ranking needs the best geometry available, not the most recent attempt.
    const completed = list.filter((r) => r.status === "COMPLETED");
    const pool = completed.length > 0 ? completed : list;
    return (
      [...pool].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0] ?? null
    );
  }

  async saveExposure(record: ExposureRecord): Promise<void> {
    const list = this.exposuresByIncident.get(record.incidentId) ?? [];
    list.push(record);
    this.exposuresByIncident.set(record.incidentId, list);
  }

  async latestExposure(incidentId: string): Promise<ExposureRecord | null> {
    const list = this.exposuresByIncident.get(incidentId) ?? [];
    return list[list.length - 1] ?? null;
  }

  async saveSites(incidentId: string, sites: SiteRecord[]): Promise<void> {
    const map = this.sites.get(incidentId) ?? new Map<string, SiteRecord>();
    for (const site of sites) {
      const existing = map.get(site.assetId);
      // A re-rank must never discard what a phone call established. Status and
      // report belong to the coordinator's workflow, not to the ranking pass.
      map.set(site.assetId, {
        ...site,
        status: existing?.status && existing.status !== "unnotified" ? existing.status : site.status,
        reported: site.reported ?? existing?.reported ?? null,
      });
    }
    this.sites.set(incidentId, map);
  }

  async getSites(incidentId: string): Promise<SiteRecord[]> {
    return [...(this.sites.get(incidentId)?.values() ?? [])].sort((a, b) => a.rank - b.rank);
  }

  async getSite(incidentId: string, assetId: string): Promise<SiteRecord | null> {
    return this.sites.get(incidentId)?.get(assetId) ?? null;
  }

  async updateSiteStatus(incidentId: string, assetId: string, status: SiteStatus): Promise<void> {
    const site = this.sites.get(incidentId)?.get(assetId);
    if (site) {
      site.status = status;
      site.updatedAt = new Date().toISOString();
    }
  }

  async setSiteReport(incidentId: string, assetId: string, report: SiteReport): Promise<void> {
    const site = this.sites.get(incidentId)?.get(assetId);
    if (site) {
      site.reported = report;
      site.status = "reported";
      site.updatedAt = new Date().toISOString();
    }
  }

  async addDecision(decision: DecisionRecord): Promise<void> {
    const list = this.decisions.get(decision.incidentId) ?? [];
    list.push(decision);
    this.decisions.set(decision.incidentId, list);
  }

  async listDecisions(incidentId: string): Promise<DecisionRecord[]> {
    return this.decisions.get(incidentId) ?? [];
  }

  async saveCall(call: CallRecord): Promise<void> {
    this.calls.set(call.id, call);
  }

  async updateCall(id: string, patch: Partial<CallRecord>): Promise<void> {
    const call = this.calls.get(id);
    if (call) this.calls.set(id, { ...call, ...patch });
  }

  async getCall(id: string): Promise<CallRecord | null> {
    return this.calls.get(id) ?? null;
  }

  async listCalls(incidentId: string): Promise<CallRecord[]> {
    return [...this.calls.values()].filter((c) => c.incidentId === incidentId);
  }

  async listOpenCalls(): Promise<CallRecord[]> {
    return [...this.calls.values()].filter(
      (c) => c.status !== "completed" && c.status !== "failed",
    );
  }

  async addTimelineEvent(event: TimelineEvent): Promise<void> {
    const list = this.events.get(event.incidentId) ?? [];
    list.push(event);
    this.events.set(event.incidentId, list);
  }

  async getTimeline(incidentId: string, limit = 200): Promise<TimelineEvent[]> {
    const list = this.events.get(incidentId) ?? [];
    return list.slice(-limit);
  }

  async saveRankingDiff(incidentId: string, diff: RankingDiff): Promise<void> {
    const list = this.diffs.get(incidentId) ?? [];
    list.push({ ...diff, at: new Date().toISOString() });
    this.diffs.set(incidentId, list);
  }

  async listRankingDiffs(incidentId: string): Promise<Array<RankingDiff & { at: string }>> {
    return this.diffs.get(incidentId) ?? [];
  }

  async getKv<T>(key: string): Promise<T | null> {
    return (this.kvStore.get(key) as T) ?? null;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    this.kvStore.set(key, value);
  }
}
