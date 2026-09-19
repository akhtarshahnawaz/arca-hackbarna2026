/**
 * List Catalan clusters, cross-check static heat sources, reuse auto simulations.
 * Never prints tokens or client secrets. Does not start a 10×6 ensemble.
 * Run: nvm use 22 && node --env-file=.env.local --experimental-strip-types scripts/deepfire-pick-demo.ts
 */

import { rememberSimulation } from "../lib/db.ts";

const CAT_BBOX = "0.15,40.52,3.33,42.86";
const TARRAGONA_INDUSTRY = { minLon: 1.15, maxLon: 1.35, minLat: 41.05, maxLat: 41.25 };

type Feature = {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function apiBase() {
  return process.env.DEEPFIRE_API_BASE_URL ?? "https://api.deepfire.co";
}

function inTarragonaIndustry(lon: number, lat: number) {
  return (
    lon >= TARRAGONA_INDUSTRY.minLon &&
    lon <= TARRAGONA_INDUSTRY.maxLon &&
    lat >= TARRAGONA_INDUSTRY.minLat &&
    lat <= TARRAGONA_INDUSTRY.maxLat
  );
}

function pointOf(feature: Feature): { lon: number; lat: number } | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

async function token(): Promise<string> {
  const clientId = process.env.DEEPFIRE_CLIENT_ID;
  const clientSecret = process.env.DEEPFIRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Deepfire credentials missing");
  }
  const response = await fetch(`${apiBase()}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) {
    throw new Error(`Deepfire token failed (${response.status})`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Deepfire token had no access_token");
  return json.access_token;
}

async function geojson(path: string, bearer: string, params: URLSearchParams) {
  const response = await fetch(`${apiBase()}${path}?${params}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return (await response.json()) as { features?: Feature[] };
}

async function main() {
  const bearer = await token();

  const clusters = await geojson("/ogc/features/v1/collections/deepfire:clusters/items", bearer, new URLSearchParams({
    bbox: CAT_BBOX,
    "filter-lang": "cql2-text",
    filter: "active = true",
    limit: "20",
    f: "application/geo+json",
  }));

  const heats = await geojson("/ogc/features/v1/collections/deepfire:static-heat-sources/items", bearer, new URLSearchParams({
    bbox: CAT_BBOX,
    limit: "200",
    f: "application/geo+json",
  }));

  const simsRes = await fetch(`${apiBase()}/v1/fire-spread/simulations?since=2026-09-01&limit=50`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  const simsJson = simsRes.ok
    ? ((await simsRes.json()) as {
        items?: Array<{
          id?: string;
          clusterId?: string;
          status?: string;
          auto?: boolean;
          locationName?: string;
        }>;
        simulations?: Array<{
          id?: string;
          clusterId?: string;
          status?: string;
          auto?: boolean;
          locationName?: string;
        }>;
      })
    : {};
  const simulations = simsJson.items ?? simsJson.simulations ?? [];

  const heatCount = heats.features?.length ?? 0;
  console.log(`static heat sources in CAT bbox: ${heatCount}`);
  console.log(`existing simulations listed: ${simulations.length} (http ${simsRes.status})`);

  const rows: Array<{
    id: string;
    lon: number;
    lat: number;
    last: string;
    industrialBox: boolean;
    onStaticHeat: boolean;
    heatType: string;
  }> = [];

  for (const feature of clusters.features ?? []) {
    const point = pointOf(feature);
    const rawId = String(feature.properties?.id ?? feature.id ?? "");
    const id = rawId.replace(/^clusters\./, "");
    if (!point || !id) continue;

    const heatHit = await geojson(
      "/ogc/features/v1/collections/deepfire:static-heat-sources/items",
      bearer,
      new URLSearchParams({
        "filter-lang": "cql2-text",
        filter: `S_INTERSECTS(geom, POINT(${point.lon} ${point.lat}))`,
        limit: "5",
        f: "application/geo+json",
      }),
    );
    const firstHeat = heatHit.features?.[0];
    rows.push({
      id,
      lon: Number(point.lon.toFixed(4)),
      lat: Number(point.lat.toFixed(4)),
      last: String(feature.properties?.last_observed ?? ""),
      industrialBox: inTarragonaIndustry(point.lon, point.lat),
      onStaticHeat: Boolean(firstHeat),
      heatType: String(firstHeat?.properties?.type ?? firstHeat?.properties?.remarks ?? ""),
    });
  }

  rows.sort((a, b) => b.last.localeCompare(a.last));
  for (const row of rows) {
    console.log(
      [
        row.id,
        `${row.lon},${row.lat}`,
        row.last,
        row.industrialBox ? "tarragona-industry-box" : "outside-industry-box",
        row.onStaticHeat ? `static-heat:${row.heatType || "yes"}` : "not-static-heat",
      ].join(" | "),
    );
  }

  const pick =
    rows.find((row) => !row.industrialBox && !row.onStaticHeat) ??
    rows.find((row) => !row.onStaticHeat) ??
    null;

  if (!pick) {
    console.log("PICK none");
    return;
  }

  console.log(`PICK ${pick.id} lon=${pick.lon} lat=${pick.lat}`);

  const matchingSims = simulations.filter((sim) => sim.clusterId === pick.id);
  for (const sim of matchingSims) {
    if (!sim.id) continue;
    await rememberSimulation({
      deepfireSimulationId: sim.id,
      clusterId: pick.id,
      status: sim.status ?? "unknown",
    });
    console.log(`REMEMBER sim ${sim.id} auto=${sim.auto === true} status=${sim.status ?? "?"}`);
  }

  if (matchingSims.length === 0) {
    const autoAny = simulations.filter((sim) => sim.auto === true).slice(0, 3);
    console.log(`no listed sim for pick; auto samples: ${autoAny.map((sim) => sim.id).join(",") || "none"}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
