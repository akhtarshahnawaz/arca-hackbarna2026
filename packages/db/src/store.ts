import type {
  Incident,
  RankedSite,
  RankingDiff,
  SiteReport,
  SiteStatus,
  TimelineEvent,
} from "@arca/core";

/**
 * The persistence contract.
 *
 * Narrow on purpose: it holds exactly what the pipeline needs to survive a
 * restart, and nothing else. Two implementations satisfy it — an in-memory one
 * that makes a laptop demo work with no database at all, and a Postgres one for
 * anything that has to outlive the process. The pipeline never learns which it
 * got, which is also what makes the whole flow testable without a container.
 */

export interface SpreadRunRecord {
  id: string;
  incidentId: string;
  simulationId: string | null;
  status: string;
  params?: unknown;
  result?: unknown;
  bands?: unknown;
  frames?: unknown;
  windSpeedMs?: number | null;
  windDirectionDeg?: number | null;
  burnedAreaM2?: number | null;
  ensembleMembers?: number | null;
  errorMessage?: string | null;
  requestedAt: string;
  completedAt?: string | null;
}

export interface ExposureRecord {
  id: string;
  incidentId: string;
  spreadRunId: string | null;
  summary?: unknown;
  bands?: unknown;
  population?: unknown;
  warnings: string[];
  degraded?: unknown;
  timing?: unknown;
  createdAt: string;
}

export interface SiteRecord {
  id: string;
  incidentId: string;
  assetId: string;
  rankingVersion: number;
  payload: RankedSite;
  status: SiteStatus;
  reported: SiteReport | null;
  rank: number;
  action: string;
  spareMinutes: number | null;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  incidentId: string;
  siteId: string | null;
  kind: "approve_call" | "deny" | "set_status" | "snooze" | "note";
  actor: string;
  via: "telegram" | "web" | "api" | "system";
  note?: string | null;
  payload?: unknown;
  at: string;
}

export interface CallRecord {
  id: string;
  incidentId: string;
  siteId: string;
  provider: string;
  providerCallId: string | null;
  phoneMasked: string;
  status: "dispatched" | "ringing" | "answered" | "completed" | "failed" | "web_session";
  mode: "phone" | "web";
  webSessionUrl?: string | null;
  /**
   * The LiveKit room SLNG opens for a browser session.
   *
   * Stored rather than discarded because it is the only handle on a session
   * that has no joinable URL — without it the record says a session exists and
   * gives no way to find it.
   */
  room?: { url: string; token: string; name: string | null } | null;
  transcript?: string | null;
  extracted?: SiteReport | null;
  extractionModel?: string | null;
  error?: string | null;
  dispatchedAt: string;
  endedAt?: string | null;
  latency?: unknown;
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  readonly kind: "memory" | "postgres";

  upsertIncident(incident: Incident): Promise<void>;
  getIncident(id: string): Promise<Incident | null>;
  getIncidentByCluster(clusterId: string): Promise<Incident | null>;
  listIncidents(filter?: { status?: string[]; replay?: boolean }): Promise<Incident[]>;
  deleteIncident(id: string): Promise<void>;

  saveHotspots(incidentId: string, hotspots: unknown[]): Promise<void>;
  getHotspots(incidentId: string): Promise<unknown[]>;

  saveSpreadRun(run: SpreadRunRecord): Promise<void>;
  latestSpreadRun(incidentId: string): Promise<SpreadRunRecord | null>;

  saveExposure(record: ExposureRecord): Promise<void>;
  latestExposure(incidentId: string): Promise<ExposureRecord | null>;

  saveSites(incidentId: string, sites: SiteRecord[]): Promise<void>;
  getSites(incidentId: string): Promise<SiteRecord[]>;
  getSite(incidentId: string, assetId: string): Promise<SiteRecord | null>;
  updateSiteStatus(incidentId: string, assetId: string, status: SiteStatus): Promise<void>;
  setSiteReport(incidentId: string, assetId: string, report: SiteReport): Promise<void>;

  addDecision(decision: DecisionRecord): Promise<void>;
  listDecisions(incidentId: string): Promise<DecisionRecord[]>;

  saveCall(call: CallRecord): Promise<void>;
  updateCall(id: string, patch: Partial<CallRecord>): Promise<void>;
  getCall(id: string): Promise<CallRecord | null>;
  listCalls(incidentId: string): Promise<CallRecord[]>;
  listOpenCalls(): Promise<CallRecord[]>;

  addTimelineEvent(event: TimelineEvent): Promise<void>;
  getTimeline(incidentId: string, limit?: number): Promise<TimelineEvent[]>;

  saveRankingDiff(incidentId: string, diff: RankingDiff): Promise<void>;
  listRankingDiffs(incidentId: string): Promise<Array<RankingDiff & { at: string }>>;

  getKv<T>(key: string): Promise<T | null>;
  setKv<T>(key: string, value: T): Promise<void>;
}

export function maskPhone(phone: string): string {
  const trimmed = phone.replace(/\s+/g, "");
  if (trimmed.length <= 6) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(0, trimmed.length - 7))}${trimmed.slice(-3)}`;
}
