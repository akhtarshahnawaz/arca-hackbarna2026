import type { HeatSource, Hotspot, LonLat } from "./types";

const CATALONIA_BBOX = "0.15,40.52,3.33,42.86";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type GeoJsonFeature = {
  id?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    cluster_id?: string;
    observed_at?: string;
    confidence?: string;
    country?: string;
    active?: boolean;
  };
};

/** Why a Deepfire call failed. Lets the console merge two reports of one cause. */
export type DeepfireFailure = "credentials" | "token" | "query" | "network" | null;

export type DeepfireStatus = {
  ok: boolean;
  detail: string;
  hotspots: Hotspot[];
  fetchedAt: string | null;
  failure: DeepfireFailure;
};

export type HeatSourceStatus = {
  ok: boolean;
  detail: string;
  heatSources: HeatSource[];
  fetchedAt: string | null;
  failure: DeepfireFailure;
  /**
   * True when the mask is the whole Catalonia box. False when the query failed
   * or paging stopped early, and a hotspot may sit on a chimney we never read.
   */
  complete: boolean;
};

function apiBase() {
  return process.env.DEEPFIRE_API_BASE_URL ?? "https://api.deepfire.co";
}

/**
 * The timeout covers the body too. Clearing it around the bare `fetch` leaves a
 * stalled response body unguarded, and Deepfire is awaited inside the same
 * `Promise.all` as every other feed.
 */
async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  ms: number,
  read: (res: Response) => Promise<T>,
): Promise<{ res: Response; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    return { res, body: await read(res) };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDeepfireHotspots(): Promise<DeepfireStatus> {
  // Same token as the heat-source query: see `deepfireToken`.
  const auth = await deepfireToken();
  if ("error" in auth) {
    return {
      ok: false,
      detail:
        auth.failure === "credentials"
          ? "Deepfire credentials missing. Showing demo fire only."
          : `${auth.error} Demo polygons stay on.`,
      hotspots: [],
      fetchedAt: null,
      failure: auth.failure,
    };
  }

  try {
    const params = new URLSearchParams({
      bbox: CATALONIA_BBOX,
      "filter-lang": "cql2-text",
      filter: "active = true AND country = 'ES'",
      limit: "80",
      f: "application/geo+json",
    });

    const { res: itemsRes, body: geo } = await fetchWithTimeout(
      `${apiBase()}/ogc/features/v1/collections/deepfire:hotspots/items?${params}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
      8000,
      (r) => r.json().catch(() => ({})) as Promise<{ features?: GeoJsonFeature[] }>,
    );

    if (!itemsRes.ok) {
      return {
        ok: false,
        detail: `Deepfire token OK, hotspot query failed (${itemsRes.status}).`,
        hotspots: [],
        fetchedAt: new Date().toISOString(),
        failure: "query",
      };
    }

    const hotspots: Hotspot[] = (geo.features ?? [])
      .map((feature) => {
        const coords = feature.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return null;
        return {
          id: String(feature.id ?? `${coords[0]},${coords[1]}`),
          lon: coords[0],
          lat: coords[1],
          observedAt: feature.properties?.observed_at ?? null,
          clusterId: feature.properties?.cluster_id ?? null,
          confidence: feature.properties?.confidence ?? null,
          country: feature.properties?.country ?? null,
        };
      })
      .filter((item): item is Hotspot => item !== null);

    const newest = hotspots
      .map((spot) => spot.observedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      ok: true,
      detail:
        hotspots.length === 0
          ? "Token live. No active ES hotspots in the Catalonia box right now."
          : `Token live. ${hotspots.length} active hotspot${hotspots.length === 1 ? "" : "s"} in the Catalonia box.`,
      hotspots,
      fetchedAt: newest ?? new Date().toISOString(),
      failure: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      detail: `Deepfire unreachable (${message}). Demo polygons stay on.`,
      hotspots: [],
      fetchedAt: null,
      failure: "network",
    };
  }
}

type TokenResult = { token: string } | { error: string; failure: DeepfireFailure };

/**
 * One token per briefing, shared by every Deepfire query. The hotspot query and
 * the heat-source query run inside the same `Promise.all`, so minting a token
 * each meant two `/v1/token` POSTs per console poll — twice the throttling
 * surface, and a short-lived token the second POST could invalidate under the
 * first. The in-flight promise is cached as well, so parallel callers share the
 * single request rather than racing two.
 */
let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<TokenResult> | null = null;

async function deepfireToken(): Promise<TokenResult> {
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { error: "Deepfire credentials missing.", failure: "credentials" };
  }

  // A minute of headroom: a token about to expire is no use to a second query.
  if (tokenCache && tokenCache.expiresAt - Date.now() > 60_000) {
    return { token: tokenCache.token };
  }
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async (): Promise<TokenResult> => {
    try {
      const { res, body: json } = await fetchWithTimeout(
        `${apiBase()}/v1/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
        },
        8000,
        (r) => r.json().catch(() => ({})) as Promise<TokenResponse>,
      );
      if (!res.ok) return { error: `Deepfire token failed (${res.status}).`, failure: "token" };
      if (!json.access_token) {
        return { error: "Deepfire token response had no access_token.", failure: "token" };
      }
      const lifetimeMs = (json.expires_in ?? 600) * 1000;
      tokenCache = { token: json.access_token, expiresAt: Date.now() + lifetimeMs };
      return { token: json.access_token };
    } catch (error) {
      const message = error instanceof Error ? error.message : "network error";
      return { error: `Deepfire unreachable (${message}).`, failure: "network" };
    } finally {
      tokenInFlight = null;
    }
  })();

  return tokenInFlight;
}

/** Drops the shared token. Tests and a credential change need a fresh mint. */
export function resetDeepfireToken(): void {
  tokenCache = null;
  tokenInFlight = null;
}

type HeatFeature = {
  id?: string | number;
  geometry?: { type?: string; coordinates?: number[][][] | number[][][][] };
  properties?: {
    type?: string;
    source?: string;
    remarks?: string;
    year?: number;
  };
};

function cleanRing(ring: unknown): LonLat[] {
  if (!Array.isArray(ring)) return [];
  return (ring as unknown[])
    .filter(
      (pair): pair is number[] =>
        Array.isArray(pair) &&
        pair.length >= 2 &&
        Number.isFinite(pair[0]) &&
        Number.isFinite(pair[1]),
    )
    .map(([lon, lat]) => [lon, lat] as LonLat);
}

/**
 * Every outer ring of the feature: one for a Polygon, one per part for a
 * MultiPolygon. Keeping only the largest part left the other parts unmasked, so
 * a hotspot on the second kiln of a two-kiln site was promoted as a real fire
 * and the polygon under it was never drawn either.
 */
function outerRings(geometry: HeatFeature["geometry"]): LonLat[][] {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const parts =
    geometry?.type === "MultiPolygon"
      ? (coords as number[][][][]).map((part) => cleanRing(part?.[0]))
      : [cleanRing((coords as number[][][])[0])];
  return parts.filter((ring) => ring.length > 0);
}

/** Centroid of the largest ring — the point the console labels the source with. */
function ringsCentroid(rings: LonLat[][]): { lat: number; lon: number } | null {
  const ring = [...rings].sort((a, b) => b.length - a.length)[0];
  if (!ring || ring.length === 0) return null;
  const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  return { lat, lon };
}

/**
 * The persistent-anomaly mask: quarries, kilns, flares and glasshouses that trip
 * a satellite fire detector every pass. They are drawn so a coordinator can see
 * that a hotspot sits on a chimney, and cross-check scoring discounts them.
 */
const HEAT_PAGE_LIMIT = 300;
/** At most 1500 masked sources per briefing. Beyond that the mask is truncated. */
const HEAT_MAX_PAGES = 5;

export async function fetchStaticHeatSources(): Promise<HeatSourceStatus> {
  const auth = await deepfireToken();
  if ("error" in auth) {
    return {
      ok: false,
      detail: `${auth.error} Static heat sources are not drawn.`,
      heatSources: [],
      fetchedAt: null,
      failure: auth.failure,
      complete: false,
    };
  }

  const heatSources: HeatSource[] = [];
  // A server that ignores `offset` answers every page with the same features.
  // Keyed by id, that costs a repeat instead of a duplicated mask.
  const seen = new Set<string>();
  let matched: number | null = null;
  let complete = false;

  try {
    for (let page = 0; page < HEAT_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        bbox: CATALONIA_BBOX,
        limit: String(HEAT_PAGE_LIMIT),
        offset: String(page * HEAT_PAGE_LIMIT),
        f: "application/geo+json",
      });

      const { res, body: geo } = await fetchWithTimeout(
        `${apiBase()}/ogc/features/v1/collections/deepfire:static-heat-sources/items?${params}`,
        { headers: { Authorization: `Bearer ${auth.token}` } },
        12000,
        (r) =>
          r.json().catch(() => ({})) as Promise<{
            features?: HeatFeature[];
            numberMatched?: number;
          }>,
      );
      if (!res.ok) {
        return {
          ok: false,
          detail: `Static heat source query failed (${res.status}). Static heat sources are not drawn.`,
          heatSources: [],
          fetchedAt: null,
          failure: "query",
          complete: false,
        };
      }

      if (typeof geo.numberMatched === "number") matched = geo.numberMatched;
      const features = geo.features ?? [];

      let added = 0;
      for (const [index, feature] of features.entries()) {
        const rings = outerRings(feature.geometry);
        const centre = ringsCentroid(rings);
        if (!centre) continue;
        const id = String(feature.id ?? `static-heat-${page}-${index}`);
        if (seen.has(id)) continue;
        seen.add(id);
        added += 1;
        const remarks = feature.properties?.remarks?.trim() || null;
        const type = feature.properties?.type?.trim() || null;
        heatSources.push({
          id,
          // An empty `remarks` used to become an empty label, which reads as
          // "no chimney here" everywhere a label is truthiness-tested.
          label: remarks ?? type ?? "Static heat source",
          type,
          remarks,
          source: feature.properties?.source ?? null,
          year: feature.properties?.year ?? null,
          lat: centre.lat,
          lon: centre.lon,
          rings,
        });
      }

      // Short page, or the server told us how many there are and we have them.
      if (features.length < HEAT_PAGE_LIMIT) {
        complete = true;
        break;
      }
      if (matched !== null && heatSources.length >= matched) {
        complete = true;
        break;
      }
      // A full page that added nothing new means paging is not advancing.
      if (added === 0) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      detail: `Static heat sources unreachable (${message}). Static heat sources are not drawn.`,
      heatSources: [],
      fetchedAt: null,
      failure: "network",
      complete: false,
    };
  }

  // A truncated mask is not a mask: a hotspot on an unread chimney would be
  // promoted as a corroborated fire, so say so and let the cross-check stand
  // down rather than claim a completeness we do not have.
  const truncated = !complete;

  return {
    ok: true,
    detail: truncated
      ? `${heatSources.length} static heat sources read, more than this briefing pages through${
          matched === null ? "" : ` (${matched} in the box)`
        }. Chimney suppression is off: hotspots are not discounted on an incomplete mask.`
      : heatSources.length === 0
        ? "No known static heat sources in the Catalonia box."
        : `${heatSources.length} known static heat source${heatSources.length === 1 ? "" : "s"} in the Catalonia box. A hotspot on one of these is a chimney, not a fire.`,
    heatSources,
    fetchedAt: new Date().toISOString(),
    failure: null,
    complete,
  };
}
