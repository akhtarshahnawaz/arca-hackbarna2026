import type { FeedDetection, FireFeedId } from "./types";

/**
 * Cross-check feeds. Deepfire is the primary detector; these are the second and
 * third opinions the console scores against.
 *
 * MITECO publishes forest-fire *statistics* (EGIF) and a daily interactive
 * report, not a machine-readable active-fire endpoint, so there is nothing to
 * query per briefing. Google Maps has no public fire-alerts API either: its
 * wildfire layer is drawn from Google SOS/Public Alerts plus the same NASA
 * satellite detections FIRMS serves. FIRMS is therefore the feed that actually
 * corroborates a Deepfire hotspot with the data those two products stand on.
 */

const CATALONIA_BBOX = "0.15,40.52,3.33,42.86";

export type FeedStatus = {
  id: FireFeedId;
  ok: boolean;
  detail: string;
  detections: FeedDetection[];
  fetchedAt: string | null;
};

/**
 * The timeout has to cover the body, not just the headers. `clearTimeout` in a
 * `finally` around the bare `fetch` fires the moment headers land, which leaves
 * a stalled body with no abort behind it — and one stalled feed hangs the
 * `Promise.all` in `getCommandState` forever, so the console never renders.
 */
async function fetchWithTimeout<T>(
  url: string,
  ms: number,
  read: (res: Response) => Promise<T>,
): Promise<{ res: Response; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    return { res, body: await read(res) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * FIRMS returns `acq_date` (2026-09-19) and `acq_time` (0413) in UTC. A blank
 * `acq_time` gives no observation time at all: padding it to "0000" would
 * invent a midnight overpass and hand the age test a number nobody measured.
 */
function firmsObservedAt(date: string, time: string): string | null {
  if (!date || !time) return null;
  const padded = time.padStart(4, "0");
  const iso = `${date}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:00Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/**
 * True when the response body is the CSV we asked for. FIRMS answers a bad key,
 * a spent quota or a throttle with 200 and a prose body, so `res.ok` and an
 * "Invalid" prefix are both too narrow: anything else parsed to zero rows and
 * was then reported as a healthy feed with no detections.
 */
export function looksLikeFirmsCsv(body: string): boolean {
  const header = body.replace(/^\uFEFF/, "").trim().split("\n")[0] ?? "";
  const columns = header.split(",").map((name) => name.trim().toLowerCase());
  return columns.includes("latitude") && columns.includes("longitude");
}

export function parseFirmsCsv(csv: string, sensor: string): FeedDetection[] {
  const lines = csv.replace(/^\uFEFF/, "").trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((name) => name.trim());
  const index = (name: string) => header.indexOf(name);
  const latAt = index("latitude");
  const lonAt = index("longitude");
  if (latAt < 0 || lonAt < 0) return [];

  const dateAt = index("acq_date");
  const timeAt = index("acq_time");
  const confidenceAt = index("confidence");

  return lines.slice(1).flatMap((line, row) => {
    const cells = line.split(",");
    const lat = Number(cells[latAt]);
    const lon = Number(cells[lonAt]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [
      {
        id: `firms-${sensor}-${row}-${lat.toFixed(4)},${lon.toFixed(4)}`,
        feed: "firms" as const,
        lat,
        lon,
        observedAt:
          dateAt >= 0 && timeAt >= 0
            ? firmsObservedAt(cells[dateAt]?.trim() ?? "", cells[timeAt]?.trim() ?? "")
            : null,
        confidence: confidenceAt >= 0 ? (cells[confidenceAt]?.trim() ?? null) : null,
      },
    ];
  });
}

/**
 * NASA FIRMS near-real-time detections over the Catalonia box. The MAP_KEY is
 * free but per-account, so a missing key degrades the feed instead of failing
 * the briefing.
 */
export async function fetchFirmsDetections(): Promise<FeedStatus> {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) {
    return {
      id: "firms",
      ok: false,
      detail:
        "FIRMS_MAP_KEY unset. Government satellite cross-check is off — hotspots show Deepfire only. Free key: firms.modaps.eosdis.nasa.gov/api/map_key/",
      detections: [],
      fetchedAt: null,
    };
  }

  const sensors = (process.env.FIRMS_SENSORS ?? "VIIRS_NOAA20_NRT,VIIRS_SNPP_NRT")
    .split(",")
    .map((sensor) => sensor.trim())
    .filter(Boolean);
  const days = process.env.FIRMS_DAY_RANGE?.trim() || "1";

  const results = await Promise.all(
    sensors.map(async (sensor) => {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${sensor}/${CATALONIA_BBOX}/${days}`;
      try {
        const { res, body } = await fetchWithTimeout(url, 10000, (r) => r.text());
        if (!res.ok || !looksLikeFirmsCsv(body)) {
          return { sensor, error: body.trim().slice(0, 80) || `HTTP ${res.status}`, rows: [] };
        }
        return { sensor, error: null, rows: parseFirmsCsv(body, sensor) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "network error";
        return { sensor, error: message, rows: [] };
      }
    }),
  );

  const detections = results.flatMap((result) => result.rows);
  const failed = results.filter((result) => result.error);

  if (failed.length === results.length) {
    return {
      id: "firms",
      ok: false,
      detail: `FIRMS unreachable (${failed[0]?.error ?? "no response"}). Cross-check is off.`,
      detections: [],
      fetchedAt: null,
    };
  }

  return {
    id: "firms",
    ok: true,
    detail: `${detections.length} NASA FIRMS detection${detections.length === 1 ? "" : "s"} in the last ${days} day${days === "1" ? "" : "s"} (${sensors.join(", ")}).${
      failed.length > 0 ? ` ${failed.length} sensor failed.` : ""
    }`,
    detections,
    fetchedAt: new Date().toISOString(),
  };
}

type GeoJsonPointFeature = {
  id?: string | number;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: Record<string, unknown>;
};

function readString(properties: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

/**
 * A timestamp normalised to ISO, or null when the layer carries nothing we can
 * read. GeoJSON services publish observation times as epoch seconds, epoch
 * milliseconds or an ISO string, and `String(1758278400000)` is not a date:
 * stringifying a number here handed the cross-check an `Invalid Date`, which
 * the age test then skipped, so a months-old polygon corroborated today's fire.
 */
export function readInstant(
  properties: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = properties?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      // Epoch seconds until ~2286; anything larger is already milliseconds.
      const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
      continue;
    }
    if (typeof value !== "string" || !value) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^-?\d+$/.test(value.trim())) {
      const ms = Math.abs(numeric) < 1e11 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
      continue;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    // A value we cannot parse is reported as such, not quietly passed on: the
    // cross-check refuses to corroborate on an unreadable timestamp.
    return null;
  }
  return null;
}

/**
 * Optional third feed: any GeoJSON point service of active fires, set through
 * EFFIS_GEOJSON_URL. Copernicus EFFIS serves its current-situation layer from
 * maps.effis.emergency.copernicus.eu, which is not reachable from every
 * network, so the URL is configuration rather than a constant.
 */
export async function fetchEffisDetections(): Promise<FeedStatus> {
  const url = process.env.EFFIS_GEOJSON_URL?.trim();
  if (!url) {
    return {
      id: "effis",
      ok: false,
      detail:
        "EFFIS_GEOJSON_URL unset. EU Copernicus cross-check is off. Point it at a GeoJSON active-fire layer to switch it on.",
      detections: [],
      fetchedAt: null,
    };
  }

  try {
    const { res, body: geo } = await fetchWithTimeout(
      url,
      12000,
      (r) => r.json().catch(() => ({})) as Promise<{ features?: GeoJsonPointFeature[] }>,
    );
    if (!res.ok) {
      return {
        id: "effis",
        ok: false,
        detail: `EFFIS feed failed (${res.status}).`,
        detections: [],
        fetchedAt: null,
      };
    }
    const detections: FeedDetection[] = (geo.features ?? []).flatMap((feature, index) => {
      // Only a Point is one detection. A MultiPoint or a LineString also has a
      // `coordinates` array of length >= 2, but its first two entries are
      // arrays, not numbers — which made `lat` an array, `haversineKm` NaN, and
      // `NaN > matchKm` false, so one bad geometry corroborated every hotspot.
      if (feature.geometry?.type !== "Point") return [];
      const coords = feature.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return [];
      const lon = coords[0];
      const lat = coords[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      return [
        {
          id: String(feature.id ?? `effis-${index}`),
          feed: "effis" as const,
          lat,
          lon,
          observedAt: readInstant(feature.properties, [
            "lastupdate",
            "last_update",
            "observed_at",
            "acq_date",
            "date",
          ]),
          confidence: readString(feature.properties, ["confidence", "class", "status"]),
        },
      ];
    });

    return {
      id: "effis",
      ok: true,
      detail: `${detections.length} EU Copernicus detection${detections.length === 1 ? "" : "s"} in the configured layer.`,
      detections,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      id: "effis",
      ok: false,
      detail: `EFFIS feed unreachable (${message}).`,
      detections: [],
      fetchedAt: null,
    };
  }
}
