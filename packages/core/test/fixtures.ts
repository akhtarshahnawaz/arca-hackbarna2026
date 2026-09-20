import type {
  ExposureAsset,
  ExposureReport,
  Hotspot,
  Simulation,
  SpreadFeature,
  StaticHeatSource,
} from "../src/domain/types.js";

export function square(cx: number, cy: number, halfSize: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [cx - halfSize, cy - halfSize],
        [cx + halfSize, cy - halfSize],
        [cx + halfSize, cy + halfSize],
        [cx - halfSize, cy + halfSize],
        [cx - halfSize, cy - halfSize],
      ],
    ],
  };
}

export function hotspot(overrides: Partial<Hotspot> = {}): Hotspot {
  return {
    id: overrides.id ?? `h-${Math.random().toString(36).slice(2, 8)}`,
    clusterId: overrides.clusterId ?? "cluster-1",
    position: overrides.position ?? [1.8, 41.7],
    observedAt: overrides.observedAt ?? "2026-09-19T12:00:00.000Z",
    source: overrides.source ?? "VIIRS_NOAA20_NRT",
    sensorClass: overrides.sensorClass ?? "viirs",
    confidence: overrides.confidence ?? "HIGH",
    fireRadiativePowerMw: overrides.fireRadiativePowerMw ?? 40,
    country: overrides.country ?? "ES",
    active: overrides.active ?? true,
  };
}

export function staticSource(
  overrides: Partial<StaticHeatSource> & { geometry?: GeoJSON.Polygon } = {},
): StaticHeatSource {
  return {
    id: overrides.id ?? "static-1",
    type: overrides.type ?? "Oil/gas",
    remarks: overrides.remarks ?? "Tarragona refinery flare",
    geometry: overrides.geometry ?? square(1.2, 41.18, 0.002),
  };
}

/** One feature per hour, no probability: a single-member run. */
export function singleRunSimulation(): Simulation {
  const features: SpreadFeature[] = [1, 2, 3, 4, 5, 6].map((hour) => ({
    type: "Feature",
    geometry: square(1.8, 41.7, 0.01 * hour),
    properties: { hour, elapsed_seconds: hour * 3600 },
  }));
  return {
    id: "sim-single",
    status: "COMPLETED",
    ensembleMembers: 1,
    durationHours: 6,
    result: { type: "FeatureCollection", features },
    summary: { burnedAreaM2: 1_000_000, windSpeedAvgMs: 4.2, windDirectionAvg: 315 },
  };
}

/**
 * Nested probability contours per hour, which is the shape DeepFire's own
 * renderer expects from an ensemble run: a small high-probability core inside a
 * larger low-probability envelope, repeated for each hour.
 */
export function ensembleSimulation(): Simulation {
  const features: SpreadFeature[] = [];
  for (const hour of [1, 2, 3, 4, 5, 6]) {
    features.push({
      type: "Feature",
      geometry: square(1.8, 41.7, 0.004 * hour),
      properties: { hour, elapsed_seconds: hour * 3600, burn_probability: 0.9 },
    });
    features.push({
      type: "Feature",
      geometry: square(1.8, 41.7, 0.008 * hour),
      properties: { hour, elapsed_seconds: hour * 3600, burn_probability: 0.5 },
    });
    features.push({
      type: "Feature",
      geometry: square(1.8, 41.7, 0.014 * hour),
      properties: { hour, elapsed_seconds: hour * 3600, burn_probability: 0.2 },
    });
    features.push({
      type: "Feature",
      geometry: square(1.8, 41.7, 0.02 * hour),
      properties: { hour, elapsed_seconds: hour * 3600, burn_probability: 0.1 },
    });
  }
  return {
    id: "sim-ensemble",
    status: "COMPLETED",
    ensembleMembers: 10,
    durationHours: 6,
    result: { type: "FeatureCollection", features },
    summary: { burnedAreaM2: 4_000_000, windSpeedAvgMs: 6.1, windDirectionAvg: 290 },
  };
}

export function asset(overrides: Partial<ExposureAsset> = {}): ExposureAsset {
  return {
    id: overrides.id ?? `a-${Math.random().toString(36).slice(2, 8)}`,
    category: overrides.category ?? "social_care",
    subcategory: overrides.subcategory ?? "care_home",
    name: overrides.name ?? "Residència Els Companys",
    geometry: overrides.geometry ?? { type: "Point", coordinates: [1.8, 41.7] },
    capacity: overrides.capacity ?? { places: 64, people: 64, basis: "RESES", confidence: 0.7 },
    contacts: overrides.contacts ?? { phone: ["+34938741122"], email: [], operator: null },
    valuation: overrides.valuation ?? { total_eur: 4_184_000, method: "default_footprint", confidence: 0.27 },
    vulnerability: overrides.vulnerability ?? 75,
    criticality: overrides.criticality ?? 100,
    hazardous: overrides.hazardous ?? false,
    response_asset: overrides.response_asset ?? false,
    human_bearing: overrides.human_bearing ?? true,
    exposure: overrides.exposure ?? {
      band: "t+1h",
      band_index: 0,
      band_minutes: 60,
      distance_to_front_m: 412,
      inside_aoi: true,
      priority_score: 88.4,
    },
    provenance: overrides.provenance ?? [{ source_id: "es.cat.reses", source_ref: "S05123" }],
    ...overrides,
  };
}

export function exposure(assets: ExposureAsset[]): ExposureReport {
  return {
    summary: {
      asset_count: assets.length,
      people_estimate: assets.reduce((s, a) => s + (a.capacity?.people ?? 0), 0),
      population_resident: 6740,
      total_value_eur: assets.reduce((s, a) => s + (a.valuation?.total_eur ?? 0), 0),
      critical_assets: assets.filter((a) => (a.criticality ?? 0) >= 90).length,
      hazardous_assets: assets.filter((a) => a.hazardous).length,
      coverage_regime: "catalonia_full",
    },
    bands: [],
    assets,
    warnings: [],
  };
}
