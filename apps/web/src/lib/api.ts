"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClusterSummary,
  ClusterSurvey,
  WatchArea,
  ExposureReport,
  Incident,
  ScenarioSummary,
  RankedSite,
  RankingDiff,
  SiteStatus,
  TimelineEvent,
} from "@arca/core";

/**
 * The agent service, from the browser.
 *
 * One fetch for the whole screen and one event stream to know when to fetch
 * again. The alternative — a request per panel — lets the map show one ranking
 * version while the list shows another, which during an incident is worse than
 * a slightly slower refresh.
 */

export const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:4000").replace(/\/$/, "");

export interface SpreadView {
  id: string;
  status: string;
  simulationId: string | null;
  bands: GeoJSON.FeatureCollection | null;
  frames: SpreadFrameView[] | null;
  windSpeedMs: number | null;
  windDirectionDeg: number | null;
  burnedAreaM2: number | null;
  ensembleMembers: number | null;
  errorMessage: string | null;
  synthetic: boolean;
  /** Drawn rings standing in while the model run is still queued. */
  provisional?: boolean;
}

export interface SpreadFrameView {
  hour: number;
  minutes: number;
  contours: Array<{ probability: number; geometry: GeoJSON.MultiPolygon; areaM2: number }>;
  cumulativeAreaM2: number;
  expectedAreaM2: number;
}

export interface HotspotView {
  id: string;
  position: [number, number];
  observedAt: string;
  source: string;
  confidence: string;
  fireRadiativePowerMw: number | null;
  flags: string[];
  reason: string | null;
  staticSourceName: string | null;
  usable: boolean;
}

export interface CallView {
  id: string;
  siteId: string;
  status: string;
  mode: string;
  phoneMasked: string;
  webSessionUrl?: string | null;
  /**
   * The LiveKit room SLNG opens when it cannot dial.
   *
   * A URL and a five-minute token, not a web page — which is why the browser
   * has to join it itself rather than following a link.
   */
  room?: { url: string; token: string; name: string | null } | null;
  transcript?: string | null;
  error?: string | null;
  dispatchedAt: string;
}

export interface ScriptView {
  siteName: string;
  language: string;
  exerciseMode: boolean;
  lines: Array<{ role: "agent" | "note"; text: string }>;
  audioAvailable: boolean;
  wouldDial: boolean;
}

export interface IncidentDetail {
  incident: Incident;
  hotspots: HotspotView[];
  spread: SpreadView | null;
  exposure: Pick<ExposureReport, "summary" | "bands" | "population" | "warnings"> & {
    degraded?: unknown;
  } | null;
  sites: RankedSite[];
  calls: CallView[];
  timeline: TimelineEvent[];
  diffs: Array<RankingDiff & { at: string }>;
}

/** Live or synthetic. The one control that changes where data comes from. */
export type Mode = "live" | "synthetic";

/** The feed, plus the areas this deployment is willing to look at. */
export interface SurveyResponse extends ClusterSurvey {
  areas: WatchArea[];
}

export interface IncidentSummary extends Incident {
  counts: { ranked: number; evacuateNow: number; shelterCandidates: number; people: number };
}

/**
 * The shared operations token.
 *
 * `OPS_TOKEN` on the agent turns authentication on for the whole API. It cannot
 * be a `NEXT_PUBLIC_*` variable — that would compile it into a bundle anyone
 * can read, which is the opposite of what it is for — so the browser holds it
 * in local storage and the operator enters it once per device.
 *
 * Without this the first protected deployment is a screen of 401s with nothing
 * to click, which is a bad way to learn that a variable is set.
 */
export const TOKEN_KEY = "arca:ops-token";

export function opsToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setOpsToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token.trim());
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing; the request will 401 again and ask again */
  }
}

export class UnauthorisedError extends Error {
  constructor() {
    super("This deployment needs an operations token.");
    this.name = "UnauthorisedError";
  }
}

let unauthorisedHandler: (() => void) | null = null;

/** Lets the page put up the token prompt the moment anything 401s. */
export function onUnauthorised(handler: (() => void) | null): void {
  unauthorisedHandler = handler;
}

function opsHeaders(): HeadersInit {
  const token = opsToken();
  return {
    "content-type": "application/json",
    ...(token ? { "x-ops-token": token } : {}),
  };
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    unauthorisedHandler?.();
    throw new UnauthorisedError();
  }
  if (!response.ok) throw new Error(`${response.status} ${await response.text().catch(() => "")}`);
  return (await response.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${AGENT_URL}${path}`, { headers: opsHeaders(), cache: "no-store" });
  return unwrap<T>(response);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${AGENT_URL}${path}`, {
    method: "POST",
    headers: opsHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return unwrap<T>(response);
}

export const api = {
  health: () => get<{ status: string; capabilities: Record<string, boolean>; storage: string }>("/api/health"),
  incidents: () => get<{ incidents: IncidentSummary[] }>("/api/incidents"),
  clusters: (options: { force?: boolean; area?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (options.force) params.set("force", "true");
    if (options.area) params.set("area", options.area);
    const query = params.toString();
    return get<SurveyResponse>(`/api/clusters${query ? `?${query}` : ""}`);
  },
  adopt: (clusterId: string) =>
    post<{ incidentId: string }>(`/api/clusters/${encodeURIComponent(clusterId)}/adopt`),
  scenarios: () => get<{ scenarios: ScenarioSummary[] }>("/api/scenarios"),
  startScenario: (name: string) =>
    post<{ incidentId: string }>(`/api/scenarios/${encodeURIComponent(name)}/start`),
  incident: (id: string) => get<IncidentDetail>(`/api/incidents/${id}`),
  replayBundles: () => get<{ bundles: string[] }>("/api/replay"),
  startReplay: (name: string, asOf?: string) =>
    post<{ incidentId: string }>(`/api/replay/${name}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`),
  refresh: (id: string, force = false) => post<unknown>(`/api/incidents/${id}/refresh?force=${force}`),
  brief: (id: string) => post<{ message: string; sentTo: number }>(`/api/incidents/${id}/brief`),
  script: (id: string, assetId: string) =>
    get<ScriptView>(`/api/incidents/${id}/sites/${encodeURIComponent(assetId)}/script`),
  tick: () => post<unknown>("/api/watch/tick"),
  decide: (
    id: string,
    body: { kind: "approve_call" | "deny" | "set_status" | "note"; assetId?: string; status?: SiteStatus; actor?: string; note?: string },
  ) => post<{ ok: boolean; message?: string }>(`/api/incidents/${id}/decisions`, body),
  transcript: (id: string, assetId: string, transcript: string) =>
    post<{ summary: string; reranked: boolean }>(`/api/incidents/${id}/transcript`, { assetId, transcript }),
  chat: (message: string, history: Array<{ role: "user" | "assistant"; content: string }>) =>
    post<{ text: string; toolsUsed: string[] }>("/api/chat", { message, history }),
};

/**
 * The left-hand feed, in whichever mode is selected.
 *
 * Polls rather than streams, because the feed is about the world outside this
 * deployment: a new cluster appears when a satellite passes overhead, not when
 * ARCA does something. The agent serves it from a one-minute cache, so polling
 * costs nothing upstream.
 */
export function useFeed(mode: Mode, area: string | null, pollMs = 60_000) {
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [areas, setAreas] = useState<WatchArea[]>([]);
  const [coverage, setCoverage] = useState<ClusterSurvey["coverage"]>("deep");
  const [error, setError] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      try {
        if (mode === "live") {
          const survey = await api.clusters({ force, area });
          setClusters(survey.clusters);
          setAreas(survey.areas ?? []);
          setCoverage(survey.coverage);
          setAt(survey.at);
          // A survey error is not a fetch error: the payload is the last good
          // feed, and saying so is more useful than blanking the list.
          setFeedError(survey.error);
        } else {
          const result = await api.scenarios();
          setScenarios(result.scenarios);
          setAt(new Date().toISOString());
          setFeedError(null);
        }
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [mode, area],
  );

  useEffect(() => {
    setLoading(true);
    void load();
    if (mode !== "live") return;
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, mode, pollMs]);

  return { clusters, scenarios, areas, coverage, error, feedError, loading, at, reload: load };
}

/** Poll-free refresh: the stream says when something changed, then we refetch. */
export function useIncident(incidentId: string | null) {
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const pending = useRef(false);

  const load = useCallback(async () => {
    if (!incidentId || pending.current) return;
    pending.current = true;
    try {
      const detail = await api.incident(incidentId);
      setData(detail);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    if (!incidentId) {
      setData(null);
      return;
    }
    setLoading(true);
    void load();
  }, [incidentId, load]);

  useEffect(() => {
    if (!incidentId) return;
    const token = opsToken();
    const url = `${AGENT_URL}/api/events?incident=${encodeURIComponent(incidentId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    const source = new EventSource(url);

    // Any of these means the payload we are holding is stale. Coalesced by the
    // pending guard, so a burst of events costs one refetch, not twenty.
    const refresh = () => void load();
    source.addEventListener("timeline", refresh);
    source.addEventListener("ranking", refresh);
    source.addEventListener("call", refresh);
    source.addEventListener("incident", refresh);
    source.addEventListener("ready", () => setLive(true));
    source.onerror = () => setLive(false);

    return () => {
      source.close();
      setLive(false);
    };
  }, [incidentId, load]);

  return { data, error, loading, live, reload: load };
}

export function useIncidentList(pollMs = 20_000) {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.incidents();
      setIncidents(result.incidents);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { incidents, error, reload: load };
}

/**
 * Count a number up when it changes.
 *
 * Used only for the impact figures. A number that lands instantly reads as a
 * new fact; a number that counts reads as a consequence unfolding, which is
 * what the scrubber is showing. Respects reduced-motion by jumping.
 */
export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || Math.abs(target - fromRef.current) < 1) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const startedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      // Ease-out cubic: fast enough to feel responsive, settled enough to read.
      const eased = 1 - (1 - progress) ** 3;
      setValue(from + (target - from) * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}

/** Sites reachable by a given hour, for the scrubber's impact figures. */
export function useExposureByHour(sites: RankedSite[], hour: number | null) {
  return useMemo(() => {
    const within =
      hour === null
        ? sites
        : sites.filter(
            (site) => site.arrivalMinutes !== null && site.arrivalMinutes <= hour * 60,
          );

    return {
      sites: within,
      count: within.length,
      people: within.reduce((sum, site) => sum + site.peopleEstimate, 0),
      livestock: within.reduce((sum, site) => sum + (site.livestockUnits ?? 0), 0),
      value: within.reduce((sum, site) => sum + (site.valueEur ?? 0), 0),
      critical: within.filter((site) => (site.priorityScore ?? 0) >= 70).length,
      hazardous: within.filter((site) => site.hazardous).length,
      evacuate: within.filter((site) => site.action === "EVACUATE_NOW").length,
      shelter: within.filter((site) => site.action === "SHELTER_CANDIDATE").length,
    };
  }, [sites, hour]);
}
