import { HttpError, requestJson } from "../util/http.js";
import { bboxOfGeometry } from "../geo/index.js";
import type {
  BandFeatureCollection,
  ExposureDegradation,
  ExposureReport,
} from "../domain/types.js";

export interface TalaiaClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  onEvent?: (event: TalaiaEvent) => void;
  /** Fallback report when every live path fails. Keeps a demo alive. */
  fixtureLoader?: (name: string) => Promise<ExposureReport | null>;
}

export interface TalaiaEvent {
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ExposureRequest {
  aoi: GeoJSON.Geometry | GeoJSON.Feature | BandFeatureCollection | GeoJSON.FeatureCollection;
  layers?: string[];
  buffer_m?: number;
  band_property?: string;
  minutes_property?: string;
  include_assets?: boolean;
  include_networks?: boolean;
  include_population?: boolean;
  include_population_grid?: boolean;
  include_geometry?: boolean;
  live_osm?: boolean;
  conflate?: boolean;
  max_assets?: number;
  sort_by?: "priority" | "distance" | "value" | "category";
}

export interface TalaiaLimits {
  tier: string;
  max_aoi_km2: number | string;
  rate_limit_per_min: number | string;
  daily_quota: number | string;
  usage_today?: number;
}

/**
 * Talaia client with a degradation ladder.
 *
 * The design rule this encodes: during an incident a partial answer beats an
 * error page. Talaia already follows it internally — a failed OpenStreetMap
 * fetch comes back as a warning on a complete response, not a 500 — and ARCA
 * extends the same principle outwards. Every rung below returns a usable
 * report and records, in `degraded`, exactly which one ran, so nothing silently
 * passes stale or thin data off as fresh and complete.
 *
 *   1. full request
 *   2. retry without live OpenStreetMap  (upstream Overpass slow or blocked)
 *   3. split the area into tiles and merge  (over the key's area cap)
 *   4. aggregates only, no asset array  (still enough to brief and rank bands)
 *   5. last good report for this incident, labelled with its age
 *   6. a recorded fixture, labelled as such
 */
export class TalaiaClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private lastGood = new Map<string, { report: ExposureReport; capturedAt: string }>();

  constructor(private readonly options: TalaiaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.options.apiKey,
      accept: "application/json",
    };
  }

  private emit(event: TalaiaEvent): void {
    this.options.onEvent?.(event);
  }

  private post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    return requestJson<T>(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: timeoutMs ?? this.timeoutMs,
      retries: 1,
    });
  }

  private get<T>(path: string): Promise<T> {
    return requestJson<T>(`${this.baseUrl}${path}`, {
      headers: this.headers(),
      timeoutMs: 30_000,
      retries: 1,
    });
  }

  // -------------------------------------------------------------------------
  // Raw endpoints
  // -------------------------------------------------------------------------

  exposureRaw(request: ExposureRequest): Promise<ExposureReport> {
    return this.post<ExposureReport>("/v1/exposure", request);
  }

  summaryRaw(request: ExposureRequest): Promise<ExposureReport> {
    return this.post<ExposureReport>("/v1/exposure/summary", request);
  }

  population(request: { aoi: unknown; include_geometry?: boolean }) {
    return this.post<ExposureReport["population"]>("/v1/population", request);
  }

  geocode(query: { address: string }) {
    return this.post<{ lon?: number; lat?: number; [k: string]: unknown }>("/v1/geocode", query);
  }

  taxonomy() {
    return this.get<unknown>("/v1/taxonomy");
  }

  sources() {
    return this.get<unknown[]>("/v1/sources");
  }

  limits() {
    return this.get<TalaiaLimits>("/v1/me");
  }

  async health(): Promise<boolean> {
    try {
      await requestJson(`${this.baseUrl}/health`, { timeoutMs: 8_000, retries: 0 });
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // The ladder
  // -------------------------------------------------------------------------

  /**
   * Fetch exposure for an area, degrading rather than failing.
   *
   * `cacheKey` scopes the last-good memo — normally the incident id, so a
   * fallback can never serve one fire's exposure for another's.
   */
  async exposure(
    request: ExposureRequest,
    context: { cacheKey?: string; fixtureName?: string } = {},
  ): Promise<ExposureReport> {
    const key = context.cacheKey ?? "default";

    // 1. Full request.
    try {
      const report = await this.exposureRaw(request);
      this.remember(key, report);
      return this.tag(report, { mode: "full" });
    } catch (error) {
      const http = error instanceof HttpError ? error : null;

      // 3. Over the area cap: Talaia says so in plain language, so split.
      if (http?.status === 422 || http?.status === 403) {
        const overArea = /area of interest/i.test(http.body) || /limit for the/i.test(http.body);
        if (overArea) {
          this.emit({
            level: "warn",
            step: "tile",
            message: "Area of interest above the key's cap. Splitting into tiles.",
            data: { detail: http.body.slice(0, 200) },
          });
          const tiled = await this.tiled(request, key).catch(() => null);
          if (tiled) return tiled;
        }
      }

      this.emit({
        level: "warn",
        step: "no_live_osm",
        message: "Full exposure request failed. Retrying without live OpenStreetMap.",
        data: { error: String(error).slice(0, 300) },
      });

      // 2. Same request, but skip the one step with an unbounded upstream.
      try {
        const report = await this.exposureRaw({ ...request, live_osm: false });
        this.remember(key, report);
        return this.tag(report, {
          mode: "no_live_osm",
          reason: "Live OpenStreetMap fetch skipped after a failed full request.",
        });
      } catch (secondError) {
        this.emit({
          level: "warn",
          step: "summary_only",
          message: "Falling back to aggregates without the asset array.",
          data: { error: String(secondError).slice(0, 300) },
        });

        // 4. Aggregates only. Bands and totals still brief a coordinator.
        try {
          const summary = await this.summaryRaw({ ...request, live_osm: false });
          const report: ExposureReport = {
            ...summary,
            assets: summary.assets ?? [],
            warnings: [
              ...(summary.warnings ?? []),
              "Asset detail unavailable: aggregates only. Per-site ranking is incomplete.",
            ],
          };
          return this.tag(report, {
            mode: "summary_only",
            reason: "Asset detail unavailable upstream.",
          });
        } catch (thirdError) {
          // 5. Last good report for this incident.
          const cached = this.lastGood.get(key);
          if (cached) {
            this.emit({
              level: "warn",
              step: "last_good",
              message: `Serving the last good exposure for this incident, captured ${cached.capturedAt}.`,
            });
            return this.tag(structuredClone(cached.report), {
              mode: "last_good",
              reason: "Every live path failed.",
              capturedAt: cached.capturedAt,
            });
          }

          // 6. Recorded fixture, clearly labelled.
          if (context.fixtureName && this.options.fixtureLoader) {
            const fixture = await this.options
              .fixtureLoader(context.fixtureName)
              .catch(() => null);
            if (fixture) {
              this.emit({
                level: "error",
                step: "fixture",
                message: `Talaia unreachable. Serving recorded fixture "${context.fixtureName}".`,
              });
              return this.tag(fixture, {
                mode: "fixture",
                reason: "Talaia unreachable.",
                name: context.fixtureName,
              });
            }
          }

          this.emit({
            level: "error",
            step: "failed",
            message: "Exposure unavailable through every path.",
            data: { error: String(thirdError).slice(0, 300) },
          });
          throw thirdError;
        }
      }
    }
  }

  /**
   * Split an oversized area into a grid and merge the results.
   *
   * Assets are de-duplicated by id because a site sitting on a tile seam comes
   * back from both calls, and counting a care home twice is precisely the
   * failure this system exists to avoid. Summary counts are recomputed from the
   * merged set rather than summed, for the same reason.
   */
  private async tiled(request: ExposureRequest, key: string): Promise<ExposureReport | null> {
    const geometry = extractGeometry(request.aoi);
    if (!geometry) return null;
    const box = bboxOfGeometry(geometry);
    if (!box) return null;

    const splits = 2;
    const lonStep = (box.maxLon - box.minLon) / splits;
    const latStep = (box.maxLat - box.minLat) / splits;
    const reports: ExposureReport[] = [];

    for (let i = 0; i < splits; i++) {
      for (let j = 0; j < splits; j++) {
        const tile: GeoJSON.Polygon = {
          type: "Polygon",
          coordinates: [
            [
              [box.minLon + i * lonStep, box.minLat + j * latStep],
              [box.minLon + (i + 1) * lonStep, box.minLat + j * latStep],
              [box.minLon + (i + 1) * lonStep, box.minLat + (j + 1) * latStep],
              [box.minLon + i * lonStep, box.minLat + (j + 1) * latStep],
              [box.minLon + i * lonStep, box.minLat + j * latStep],
            ],
          ],
        };
        try {
          reports.push(await this.exposureRaw({ ...request, aoi: tile, live_osm: false }));
        } catch {
          // One dead tile is a gap in coverage, not a dead incident.
        }
      }
    }

    if (reports.length === 0) return null;

    const byId = new Map<string, ExposureReport["assets"][number]>();
    const warnings = new Set<string>();
    for (const report of reports) {
      for (const asset of report.assets ?? []) byId.set(asset.id, asset);
      for (const warning of report.warnings ?? []) warnings.add(warning);
    }
    const assets = [...byId.values()];

    const merged: ExposureReport = {
      summary: {
        ...(reports[0]?.summary ?? {}),
        asset_count: assets.length,
        people_estimate: sumBy(assets, (a) => a.capacity?.people ?? a.capacity?.places ?? 0),
        total_value_eur: sumBy(assets, (a) => a.valuation?.total_eur ?? 0),
        critical_assets: assets.filter((a) => (a.criticality ?? 0) >= 90).length,
        hazardous_assets: assets.filter((a) => a.hazardous).length,
      },
      bands: reports[0]?.bands ?? [],
      assets,
      warnings: [
        ...warnings,
        `Area split into ${reports.length} tiles to fit the key's area cap; per-band aggregates come from the first tile.`,
      ],
      population: reports[0]?.population ?? null,
    };

    this.remember(key, merged);
    return this.tag(merged, {
      mode: "tiled",
      reason: "Area of interest above the key's cap.",
      tiles: reports.length,
    });
  }

  private remember(key: string, report: ExposureReport): void {
    if ((report.assets?.length ?? 0) === 0) return;
    this.lastGood.set(key, { report, capturedAt: new Date().toISOString() });
  }

  private tag(report: ExposureReport, degraded: ExposureDegradation): ExposureReport {
    return { ...report, warnings: report.warnings ?? [], degraded };
  }
}

function sumBy<T>(items: T[], pick: (item: T) => number | null | undefined): number {
  return items.reduce((sum, item) => sum + (pick(item) ?? 0), 0);
}

function extractGeometry(aoi: ExposureRequest["aoi"]): GeoJSON.Geometry | null {
  if (!aoi || typeof aoi !== "object") return null;
  const type = (aoi as { type?: string }).type;
  if (type === "FeatureCollection") {
    const features = (aoi as GeoJSON.FeatureCollection).features ?? [];
    const last = features[features.length - 1];
    return last?.geometry ?? null;
  }
  if (type === "Feature") return (aoi as GeoJSON.Feature).geometry ?? null;
  return aoi as GeoJSON.Geometry;
}
