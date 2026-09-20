import { HttpError, Semaphore, TtlCache, request, requestJson } from "../util/http.js";
import type {
  ClusterProperties,
  DeepFireCollection,
  DeepFireTokenResponse,
  HotspotProperties,
  ItemsQuery,
  PerimeterProperties,
  SimulationRequest,
  StaticHeatSourceProperties,
} from "./types.js";
import type { Simulation } from "../domain/types.js";

const DEFAULT_BASE_URL = "https://api.deepfire.co";

/** Survives process restarts so a 180-day token is not re-minted every boot. */
export interface TokenStore {
  get(): Promise<{ value: string; expiresAt: number } | null>;
  set(token: { value: string; expiresAt: number }): Promise<void>;
}

export interface DeepFireClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenStore?: TokenStore;
  /** DeepFire caps fire-spread runs at 2 in flight per API client. */
  maxConcurrentSimulations?: number;
  onRetry?: (attempt: number, error: unknown, waitMs: number) => void;
}

export class DeepFireClient {
  private readonly baseUrl: string;
  private readonly simulationGate: Semaphore;
  private token: { value: string; expiresAt: number } | null = null;
  private inFlightToken: Promise<string> | null = null;

  constructor(private readonly options: DeepFireClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.simulationGate = new Semaphore(options.maxConcurrentSimulations ?? 2);
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Tokens last 180 days and there is no refresh grant, so the only correct
   * behaviour is to cache hard and re-mint on 401. The in-flight promise stops
   * a cold start with ten concurrent requests from minting ten tokens.
   */
  private async bearer(force = false): Promise<string> {
    const stillFresh = (t: { expiresAt: number } | null) =>
      Boolean(t && t.expiresAt > Date.now() + 60_000);

    if (!force && stillFresh(this.token)) return this.token!.value;
    if (!force && this.inFlightToken) return this.inFlightToken;

    this.inFlightToken = (async () => {
      if (!force && this.options.tokenStore) {
        const cached = await this.options.tokenStore.get().catch(() => null);
        if (stillFresh(cached)) {
          this.token = cached;
          return cached!.value;
        }
      }

      const payload = await requestJson<DeepFireTokenResponse>(`${this.baseUrl}/v1/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }),
        retries: 2,
        onRetry: this.options.onRetry,
      });

      const token = {
        value: payload.access_token,
        expiresAt: Date.now() + payload.expires_in * 1000,
      };
      this.token = token;
      await this.options.tokenStore?.set(token).catch(() => undefined);
      return token.value;
    })();

    try {
      return await this.inFlightToken;
    } finally {
      this.inFlightToken = null;
    }
  }

  private async authedJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
    const run = async (force: boolean) =>
      requestJson<T>(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${await this.bearer(force)}`,
        },
        retries: 2,
        timeoutMs: init.timeoutMs ?? 35_000,
        onRetry: this.options.onRetry,
      });

    try {
      return await run(false);
    } catch (error) {
      // 401 means the cached token died early. Re-mint once, then give up.
      if (error instanceof HttpError && error.status === 401) return run(true);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // OGC Features
  // -------------------------------------------------------------------------

  /**
   * Paged item fetch.
   *
   * The API omits `numberMatched`, so the only termination signal is a short
   * page. `startIndex` is used rather than following `next` because deep paging
   * needs a guard: very large offsets are slow enough to hit the 30-second
   * query limit, and `maxPages` is where that guard lives.
   */
  async items<P>(
    collection: DeepFireCollection,
    query: ItemsQuery = {},
  ): Promise<Array<GeoJSON.Feature<GeoJSON.Geometry, P>>> {
    const limit = Math.min(query.limit ?? 5_000, 10_000);
    const maxPages = query.maxPages ?? 20;
    const features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>> = [];

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({
        f: "application/geo+json",
        limit: String(limit),
        startIndex: String(page * limit),
      });
      if (query.bbox) params.set("bbox", query.bbox);
      if (query.sortby) params.set("sortby", query.sortby);
      if (query.filter) {
        params.set("filter-lang", "cql2-text");
        params.set("filter", query.filter);
      }

      const url = `${this.baseUrl}/ogc/features/v1/collections/deepfire:${collection}/items?${params}`;
      const fc = await this.authedJson<GeoJSON.FeatureCollection<GeoJSON.Geometry, P>>(url);
      const batch = fc.features ?? [];
      features.push(...batch);
      if (batch.length < limit) break;
    }

    return features;
  }

  hotspots(query: ItemsQuery = {}) {
    return this.items<HotspotProperties>("hotspots", query);
  }

  clusters(query: ItemsQuery = {}) {
    return this.items<ClusterProperties>("clusters", query);
  }

  perimeters(query: ItemsQuery = {}) {
    return this.items<PerimeterProperties>("satellite-perimeters", query);
  }

  staticHeatSources(query: ItemsQuery = {}) {
    return this.items<StaticHeatSourceProperties>("static-heat-sources", {
      limit: 10_000,
      ...query,
    });
  }

  // -------------------------------------------------------------------------
  // Fire spread
  // -------------------------------------------------------------------------

  async createSimulation(body: SimulationRequest): Promise<Simulation> {
    return this.simulationGate.run(() =>
      this.authedJson<Simulation>(`${this.baseUrl}/v1/fire-spread/simulations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      }),
    );
  }

  async getSimulation(id: string): Promise<Simulation> {
    return this.authedJson<Simulation>(`${this.baseUrl}/v1/fire-spread/simulations/${id}`);
  }

  async listSimulations(params: { since?: string; limit?: number } = {}): Promise<Simulation[]> {
    const search = new URLSearchParams();
    if (params.since) search.set("since", params.since);
    if (params.limit) search.set("limit", String(params.limit));
    const url = `${this.baseUrl}/v1/fire-spread/simulations?${search}`;
    const payload = await this.authedJson<Simulation[] | { simulations?: Simulation[] }>(url);
    return Array.isArray(payload) ? payload : (payload.simulations ?? []);
  }

  /**
   * Poll a simulation to a terminal state.
   *
   * Gives up well before DeepFire's own 60-minute ceiling: an incident that has
   * waited ten minutes for a model run needs the buffered-perimeter fallback
   * and a ranked list now, not a better polygon later.
   */
  async waitForSimulation(
    id: string,
    opts: {
      maxWaitMs?: number;
      pollIntervalMs?: number;
      onPoll?: (simulation: Simulation, elapsedMs: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<Simulation> {
    const maxWaitMs = opts.maxWaitMs ?? 10 * 60_000;
    const interval = opts.pollIntervalMs ?? 10_000;
    const startedAt = Date.now();

    for (;;) {
      if (opts.signal?.aborted) throw new Error("Simulation polling aborted");
      const simulation = await this.getSimulation(id);
      const elapsed = Date.now() - startedAt;
      opts.onPoll?.(simulation, elapsed);

      if (simulation.status !== "QUEUED") return simulation;
      if (elapsed > maxWaitMs) {
        return {
          ...simulation,
          status: "FAILED",
          errorMessage: `ARCA stopped waiting after ${Math.round(elapsed / 1000)}s. The run may still finish upstream.`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /** Raw passthrough, used by the health check. */
  async collections(): Promise<unknown> {
    return this.authedJson(`${this.baseUrl}/ogc/features/v1/collections?f=application/json`);
  }

  async ping(): Promise<boolean> {
    try {
      await this.bearer();
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory token store. The agent swaps in a database-backed one. */
export function memoryTokenStore(): TokenStore {
  let token: { value: string; expiresAt: number } | null = null;
  return {
    async get() {
      return token;
    },
    async set(next) {
      token = next;
    },
  };
}

export { HttpError, TtlCache, request };
