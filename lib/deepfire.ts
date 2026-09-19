import type { Hotspot } from "@/lib/types";

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
