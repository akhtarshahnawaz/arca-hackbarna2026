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

export type DeepfireStatus = {
  ok: boolean;
  detail: string;
  hotspots: Hotspot[];
  fetchedAt: string | null;
};

export type HeatSourceStatus = {
  ok: boolean;
  detail: string;
  heatSources: HeatSource[];
  fetchedAt: string | null;
};

function apiBase() {
  return process.env.DEEPFIRE_API_BASE_URL ?? "https://api.deepfire.co";
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDeepfireHotspots(): Promise<DeepfireStatus> {
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      detail: "Deepfire credentials missing. Showing demo fire only.",
      hotspots: [],
      fetchedAt: null,
    };
  }

  try {
    const tokenRes = await fetchWithTimeout(`${apiBase()}/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      return {
        ok: false,
        detail: `Deepfire token failed (${tokenRes.status}). Demo polygons stay on.`,
        hotspots: [],
        fetchedAt: null,
      };
    }

    const tokenJson = (await tokenRes.json()) as TokenResponse;
    if (!tokenJson.access_token) {
      return {
        ok: false,
        detail: "Deepfire token response had no access_token. Demo polygons stay on.",
        hotspots: [],
        fetchedAt: null,
      };
    }

    const params = new URLSearchParams({
      bbox: CATALONIA_BBOX,
      "filter-lang": "cql2-text",
      filter: "active = true AND country = 'ES'",
      limit: "80",
      f: "application/geo+json",
    });

    const itemsRes = await fetchWithTimeout(
      `${apiBase()}/ogc/features/v1/collections/deepfire:hotspots/items?${params}`,
      { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
    );

    if (!itemsRes.ok) {
      return {
        ok: false,
        detail: `Deepfire token OK, hotspot query failed (${itemsRes.status}).`,
        hotspots: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    const geo = (await itemsRes.json()) as { features?: GeoJsonFeature[] };
    const hotspots: Hotspot[] = (geo.features ?? [])
      .map((feature) => {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      detail: `Deepfire unreachable (${message}). Demo polygons stay on.`,
      hotspots: [],
      fetchedAt: null,
    };
  }
}

type TokenResult = { token: string } | { error: string };

async function deepfireToken(): Promise<TokenResult> {
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { error: "Deepfire credentials missing." };

  try {
    const res = await fetchWithTimeout(`${apiBase()}/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) return { error: `Deepfire token failed (${res.status}).` };
    const json = (await res.json()) as TokenResponse;
    if (!json.access_token) return { error: "Deepfire token response had no access_token." };
    return { token: json.access_token };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return { error: `Deepfire unreachable (${message}).` };
  }
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

/** Outer ring of a Polygon, or of the largest part of a MultiPolygon. */
function outerRing(geometry: HeatFeature["geometry"]): LonLat[] {
  const coords = geometry?.coordinates;
  if (!coords || coords.length === 0) return [];
  const rings =
    geometry?.type === "MultiPolygon"
      ? (coords as number[][][][])
          .map((part) => part[0])
          .sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0]
      : (coords as number[][][])[0];
  if (!rings) return [];
  return rings
    .filter((pair): pair is number[] => Array.isArray(pair) && pair.length >= 2)
    .map(([lon, lat]) => [lon, lat] as LonLat);
}

function ringCentroid(ring: LonLat[]): { lat: number; lon: number } | null {
  if (ring.length === 0) return null;
  const lon = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  return { lat, lon };
}

/**
 * The persistent-anomaly mask: quarries, kilns, flares and glasshouses that trip
 * a satellite fire detector every pass. They are drawn so a coordinator can see
 * that a hotspot sits on a chimney, and cross-check scoring discounts them.
 */
export async function fetchStaticHeatSources(): Promise<HeatSourceStatus> {
  const auth = await deepfireToken();
  if ("error" in auth) {
    return {
      ok: false,
      detail: `${auth.error} Static heat sources are not drawn.`,
      heatSources: [],
      fetchedAt: null,
    };
  }

  const params = new URLSearchParams({
    bbox: CATALONIA_BBOX,
    limit: "300",
    f: "application/geo+json",
  });

  try {
    const res = await fetchWithTimeout(
      `${apiBase()}/ogc/features/v1/collections/deepfire:static-heat-sources/items?${params}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
      12000,
    );
    if (!res.ok) {
      return {
        ok: false,
        detail: `Static heat source query failed (${res.status}).`,
        heatSources: [],
        fetchedAt: null,
      };
    }

    const geo = (await res.json()) as { features?: HeatFeature[] };
    const heatSources: HeatSource[] = (geo.features ?? [])
      .map((feature, index) => {
        const ring = outerRing(feature.geometry);
        const centre = ringCentroid(ring);
        if (!centre) return null;
        const remarks = feature.properties?.remarks ?? null;
        return {
          id: String(feature.id ?? `static-heat-${index}`),
          label: remarks ?? feature.properties?.type ?? "Static heat source",
          type: feature.properties?.type ?? null,
          remarks,
          source: feature.properties?.source ?? null,
          year: feature.properties?.year ?? null,
          lat: centre.lat,
          lon: centre.lon,
          ring,
        };
      })
      .filter((item): item is HeatSource => item !== null);

    return {
      ok: true,
      detail:
        heatSources.length === 0
          ? "No known static heat sources in the Catalonia box."
          : `${heatSources.length} known static heat source${heatSources.length === 1 ? "" : "s"} in the Catalonia box. A hotspot on one of these is a chimney, not a fire.`,
      heatSources,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      detail: `Static heat sources unreachable (${message}).`,
      heatSources: [],
      fetchedAt: null,
    };
  }
}
