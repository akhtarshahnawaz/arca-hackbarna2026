import type { Geometry, MultiPolygon, Polygon } from "geojson";

import polygonClipping from "polygon-clipping";
import type { Geom } from "polygon-clipping";
import {
  circlePolygon,
  geometryAreaM2,
  pointInGeometry,
  type Position,
} from "../geo/index.js";
import { rankingPolicy } from "../config/index.js";
import type {
  BandFeature,
  BandFeatureCollection,
  ReachStats,
  Simulation,
  SpreadFeature,
} from "../domain/types.js";

/**
 * Fire spread, from DeepFire's output to something an exposure API can answer.
 *
 * The shape this module consumes was verified against DeepFire's own renderer
 * rather than inferred: a completed run returns one FeatureCollection whose
 * features each carry `hour`, and on an ensemble run also `burn_probability` —
 * the share of members that had burned that polygon by that hour. There are no
 * per-member polygons to intersect. DeepFire's web app detects the ensemble
 * case with exactly the test below, colours by probability at 0.2/0.4/0.6/0.8/1
 * and weights burned area by it, so ARCA reads the same field the same way.
 */

export const PROBABILITY_FLOOR = rankingPolicy.probabilityFloor;

export function isEnsemble(collection: { features?: SpreadFeature[] } | null | undefined): boolean {
  return Boolean(
    collection?.features?.some(
      (f) => f.properties?.burn_probability !== undefined && f.properties.burn_probability < 1,
    ),
  );
}

/** Probability attached to a feature; a single-member run is certainty. */
function probabilityOf(feature: SpreadFeature): number {
  const value = feature.properties?.burn_probability;
  return value === undefined || value === null ? 1 : value;
}

function toGeom(geometry: Polygon | MultiPolygon): Geom {
  return geometry.type === "Polygon"
    ? (geometry.coordinates as unknown as Geom)
    : (geometry.coordinates as unknown as Geom);
}

function fromMultiPolygon(coords: number[][][][]): MultiPolygon {
  return { type: "MultiPolygon", coordinates: coords };
}

/**
 * Union a set of polygons into one geometry.
 *
 * Overlapping rings inside a single MultiPolygon are invalid GeoJSON and
 * different consumers disagree about what to do with them, which for an
 * exposure query means an asset counted twice or not at all. Unioning up front
 * removes the ambiguity.
 */
export function unionGeometries(
  geometries: Array<Polygon | MultiPolygon>,
): MultiPolygon | null {
  if (geometries.length === 0) return null;
  const [head, ...rest] = geometries;
  if (!head) return null;
  try {
    const result = polygonClipping.union(toGeom(head), ...rest.map(toGeom));
    if (!result || result.length === 0) return null;
    return fromMultiPolygon(result as unknown as number[][][][]);
  } catch {
    // A self-intersecting ring from the model should degrade the footprint, not
    // fail the incident: fall back to the largest single polygon.
    const largest = [...geometries].sort((a, b) => geometryAreaM2(b) - geometryAreaM2(a))[0];
    if (!largest) return null;
    return largest.type === "MultiPolygon"
      ? largest
      : { type: "MultiPolygon", coordinates: [largest.coordinates] };
  }
}

export interface BandOptions {
  horizonHours?: number;
  probabilityFloor?: number;
  /** Hours to emit. Defaults to every hour up to the horizon. */
  hours?: number[];
}

/**
 * Cumulative arrival bands, ready to POST to Talaia as the area of interest.
 *
 * Cumulative rather than per-hour rings because Talaia assigns each asset to the
 * earliest band that reaches it: nested footprints give exactly that, while
 * disjoint annuli would drop anything sitting on a boundary.
 */
export function bandsFromSimulation(
  simulation: Simulation,
  options: BandOptions = {},
): BandFeatureCollection {
  const horizon = options.horizonHours ?? rankingPolicy.horizonHours;
  const floor = options.probabilityFloor ?? PROBABILITY_FLOOR;
  const features = (simulation.result?.features ?? []) as SpreadFeature[];

  const byHour = new Map<number, SpreadFeature[]>();
  for (const feature of features) {
    const hour = feature.properties?.hour;
    if (typeof hour !== "number" || hour < 1) continue;
    const bucket = byHour.get(hour);
    if (bucket) bucket.push(feature);
    else byHour.set(hour, [feature]);
  }

  const hours =
    options.hours ??
    [...new Set([...byHour.keys()].filter((h) => h <= horizon))].sort((a, b) => a - b);

  const out: BandFeature[] = [];
  const accumulated: Array<Polygon | MultiPolygon> = [];

  for (const hour of hours) {
    const atHour = (byHour.get(hour) ?? []).filter((f) => probabilityOf(f) >= floor);
    for (const feature of atHour) {
      if (feature.geometry) accumulated.push(feature.geometry);
    }
    const geometry = unionGeometries(accumulated);
    if (!geometry) continue;

    out.push({
      type: "Feature",
      geometry,
      properties: {
        band: `t+${hour}h`,
        minutes: hour * 60,
        hour,
        probabilityFloor: floor,
        areaM2: Math.round(geometryAreaM2(geometry)),
      },
    });
  }

  return { type: "FeatureCollection", features: out };
}

/**
 * The footprint as it stands at each hour, for the map's playback animation.
 *
 * Contours are cumulative *through* that hour at each probability level, so a
 * frame is a complete picture of the fire at that moment and the map can draw
 * exactly one frame rather than stacking six of them. Two reasons that matters:
 *
 *   - A fire does not shrink. If the model emits a slightly smaller polygon at
 *     hour 4 than at hour 3 — which happens, because each hour is fitted
 *     independently — playing the frames back makes the fire pulse. Unioning
 *     forward removes that without inventing anything: a cell that could burn
 *     by hour 3 can still burn by hour 4.
 *   - Drawing every hour at once is what made the map unreadable. Six hours by
 *     five probability levels is thirty nested rings; at the end of the horizon
 *     they crowd into a dartboard. One frame is five.
 */
export interface SpreadFrame {
  hour: number;
  minutes: number;
  /** Highest probability contour at this hour, outermost first. */
  contours: Array<{ probability: number; geometry: MultiPolygon; areaM2: number }>;
  cumulativeAreaM2: number;
  expectedAreaM2: number;
}

export function spreadFrames(
  simulation: Simulation,
  options: BandOptions = {},
): SpreadFrame[] {
  const horizon = options.horizonHours ?? rankingPolicy.horizonHours;
  const features = (simulation.result?.features ?? []) as SpreadFeature[];

  const byHour = new Map<number, SpreadFeature[]>();
  for (const feature of features) {
    const hour = feature.properties?.hour;
    if (typeof hour !== "number" || hour < 1 || hour > horizon) continue;
    const bucket = byHour.get(hour);
    if (bucket) bucket.push(feature);
    else byHour.set(hour, [feature]);
  }

  const accumulated: Array<Polygon | MultiPolygon> = [];
  const frames: SpreadFrame[] = [];

  // Geometry seen so far at each probability level, carried forward hour by
  // hour. This is what makes a frame a complete picture rather than a delta.
  const carried = new Map<number, Array<Polygon | MultiPolygon>>();

  for (const hour of [...byHour.keys()].sort((a, b) => a - b)) {
    const atHour = byHour.get(hour) ?? [];

    for (const feature of atHour) {
      if (!feature.geometry) continue;
      const p = Math.round(probabilityOf(feature) * 100) / 100;
      const bucket = carried.get(p);
      if (bucket) bucket.push(feature.geometry);
      else carried.set(p, [feature.geometry]);
      accumulated.push(feature.geometry);
    }

    const contours = [...carried.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([probability, geometries]) => {
        const geometry = unionGeometries(geometries);
        return geometry
          ? { probability, geometry, areaM2: Math.round(geometryAreaM2(geometry)) }
          : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const cumulative = unionGeometries(accumulated);
    const expectedAreaM2 = atHour.reduce(
      (sum, f) => sum + geometryAreaM2(f.geometry) * probabilityOf(f),
      0,
    );

    frames.push({
      hour,
      minutes: hour * 60,
      contours,
      cumulativeAreaM2: Math.round(geometryAreaM2(cumulative)),
      expectedAreaM2: Math.round(expectedAreaM2),
    });
  }

  return frames;
}

/**
 * Burn probability at a point by a given hour.
 *
 * Takes the maximum over every feature at or before that hour, which is correct
 * whether the model emits nested probability contours or a partition: either
 * way the highest probability covering the point is the probability the point
 * burns. Monotone in `hour` by construction, which is what makes the arrival
 * search below a simple scan.
 */
export function probabilityAt(
  point: Position,
  simulation: Simulation,
  hour: number,
): number {
  const features = (simulation.result?.features ?? []) as SpreadFeature[];
  let best = 0;
  for (const feature of features) {
    const featureHour = feature.properties?.hour;
    if (typeof featureHour !== "number" || featureHour > hour) continue;
    const p = probabilityOf(feature);
    if (p <= best) continue;
    if (pointInGeometry(point, feature.geometry)) best = p;
  }
  return best;
}

/**
 * When the fire reaches a point, and in how many runs.
 *
 * Two arrival times on purpose. The conservative one drives the clock, because
 * planning an evacuation against the median means being wrong half the time in
 * the direction that kills people. The median is reported alongside so the
 * coordinator can see how pessimistic the first number is.
 */
export function reachStats(
  point: Position,
  simulation: Simulation,
  options: BandOptions & { ensembleMembers?: number } = {},
): ReachStats {
  const horizon = options.horizonHours ?? rankingPolicy.horizonHours;
  const floor = options.probabilityFloor ?? PROBABILITY_FLOOR;
  const members =
    options.ensembleMembers ?? simulation.ensembleMembers ?? rankingPolicy.ensembleMembers;
  const singleRun = !isEnsemble(simulation.result);

  const hours: number[] = [];
  for (const feature of (simulation.result?.features ?? []) as SpreadFeature[]) {
    const hour = feature.properties?.hour;
    if (typeof hour === "number" && hour >= 1 && hour <= horizon) hours.push(hour);
  }
  const sortedHours = [...new Set(hours)].sort((a, b) => a - b);

  let pReach = 0;
  let arrivalP20: number | null = null;
  let arrivalP50: number | null = null;

  for (const hour of sortedHours) {
    const p = probabilityAt(point, simulation, hour);
    if (p > pReach) pReach = p;
    if (arrivalP20 === null && p >= floor) arrivalP20 = hour * 60;
    if (arrivalP50 === null && p >= rankingPolicy.majorityProbability) arrivalP50 = hour * 60;
  }

  return {
    pReach,
    arrivalMinutesP20: arrivalP20,
    arrivalMinutesP50: arrivalP50,
    runsReaching: singleRun ? (pReach > 0 ? 1 : 0) : Math.round(pReach * members),
    runsTotal: singleRun ? 1 : members,
    singleRun,
  };
}

/**
 * Bands for an incident the model could not simulate.
 *
 * A FAILED run must not leave the coordinator with an empty screen, so the last
 * known perimeter is grown by a blunt constant rate. It is labelled everywhere
 * it appears: this is a circle drawn around a fire, not a prediction, and the
 * UI says so in the legend rather than letting it pass as model output.
 */
export function fallbackBands(
  origin: Position | Geometry,
  options: { horizonHours?: number; metersPerHour?: number } = {},
): BandFeatureCollection {
  const horizon = options.horizonHours ?? rankingPolicy.horizonHours;
  const rate = options.metersPerHour ?? 500;
  const centre: Position = Array.isArray(origin)
    ? origin
    : centroidOfGeometry(origin) ?? [0, 0];

  const features: BandFeature[] = [];
  for (let hour = 1; hour <= horizon; hour++) {
    const geometry = circlePolygon(centre, rate * hour, 72);
    features.push({
      type: "Feature",
      geometry,
      properties: {
        band: `t+${hour}h`,
        minutes: hour * 60,
        hour,
        probabilityFloor: 0,
        areaM2: Math.round(geometryAreaM2(geometry)),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function centroidOfGeometry(geometry: Geometry): Position | null {
  const points: Position[] = [];
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push([coords[0] as number, coords[1] as number]);
      return;
    }
    for (const child of coords) visit(child);
  };
  visit((geometry as { coordinates?: unknown }).coordinates);
  if (points.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / points.length, lat / points.length];
}

/** The outermost band, used as the AOI when only one polygon is wanted. */
export function outerBand(bands: BandFeatureCollection): BandFeature | null {
  return bands.features.length > 0 ? (bands.features[bands.features.length - 1] ?? null) : null;
}
