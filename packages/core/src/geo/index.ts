/**
 * Geometry primitives.
 *
 * Deliberately dependency-free and allocation-light: every function here runs
 * inside the hot loop that tests a few thousand assets against a few dozen
 * spread polygons, several times per incident. Anything that needs real
 * polygon algebra (union, difference) lives in `spread/bands.ts` and uses
 * `polygon-clipping`; everything in this file is arithmetic.
 */

export type Position = [number, number];
export type Ring = Position[];
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineMeters(a: Position, b: Position): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haversineKm(a: Position, b: Position): number {
  return haversineMeters(a, b) / 1000;
}

/**
 * Ray casting, with the boundary counted as inside.
 *
 * Boundary inclusion matters here: a hotspot pixel centre that lands exactly on
 * the edge of a quarry polygon is a quarry, and excluding it would leak a known
 * false positive into the ranked list.
 */
export function pointInRing(point: Position, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    if (yi === y && xi === x) return true;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point in a GeoJSON Polygon coordinate array (outer ring minus holes). */
export function pointInPolygon(point: Position, coords: PolygonCoords): boolean {
  const outer = coords[0];
  if (!outer || !pointInRing(point, outer)) return false;
  for (let i = 1; i < coords.length; i++) {
    const hole = coords[i];
    if (hole && pointInRing(point, hole)) return false;
  }
  return true;
}

/** Point in a GeoJSON MultiPolygon coordinate array. */
export function pointInMultiPolygon(point: Position, coords: MultiPolygonCoords): boolean {
  for (const polygon of coords) {
    if (pointInPolygon(point, polygon)) return true;
  }
  return false;
}

/** Point in any GeoJSON Polygon or MultiPolygon geometry. */
export function pointInGeometry(
  point: Position,
  geometry: GeoJSON.Geometry | null | undefined,
): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates as PolygonCoords);
  }
  if (geometry.type === "MultiPolygon") {
    return pointInMultiPolygon(point, geometry.coordinates as MultiPolygonCoords);
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.some((g) => pointInGeometry(point, g));
  }
  return false;
}

export function bboxOfGeometry(geometry: GeoJSON.Geometry): BBox | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let seen = false;

  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const lon = coords[0] as number;
      const lat = coords[1] as number;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      seen = true;
      return;
    }
    for (const child of coords) visit(child);
  };

  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const b = bboxOfGeometry(g);
      if (!b) continue;
      minLon = Math.min(minLon, b.minLon);
      minLat = Math.min(minLat, b.minLat);
      maxLon = Math.max(maxLon, b.maxLon);
      maxLat = Math.max(maxLat, b.maxLat);
      seen = true;
    }
  } else {
    visit((geometry as { coordinates?: unknown }).coordinates);
  }

  return seen ? { minLon, minLat, maxLon, maxLat } : null;
}

export function bboxContains(box: BBox, point: Position): boolean {
  return (
    point[0] >= box.minLon &&
    point[0] <= box.maxLon &&
    point[1] >= box.minLat &&
    point[1] <= box.maxLat
  );
}

export function expandBBox(box: BBox, meters: number): BBox {
  const latDelta = meters / 110_540;
  const midLat = (box.minLat + box.maxLat) / 2;
  const lonDelta = meters / (111_320 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    minLon: box.minLon - lonDelta,
    minLat: box.minLat - latDelta,
    maxLon: box.maxLon + lonDelta,
    maxLat: box.maxLat + latDelta,
  };
}

export function bboxToParam(box: BBox): string {
  return [box.minLon, box.minLat, box.maxLon, box.maxLat].map((n) => n.toFixed(5)).join(",");
}

export function parseBBox(value: string): BBox {
  const parts = value.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid bbox: "${value}". Expected minLon,minLat,maxLon,maxLat.`);
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * A circle approximated as a polygon ring, with longitude scaled by cos(lat)
 * so it is round on the ground rather than round in degrees.
 */
export function circleRing(centre: Position, radiusMeters: number, steps = 64): Ring {
  const [lon, lat] = centre;
  const latDelta = radiusMeters / 110_540;
  const lonDelta = radiusMeters / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const ring: Ring = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lon + lonDelta * Math.cos(theta), lat + latDelta * Math.sin(theta)]);
  }
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

export function circlePolygon(
  centre: Position,
  radiusMeters: number,
  steps = 64,
): GeoJSON.Polygon {
  return { type: "Polygon", coordinates: [circleRing(centre, radiusMeters, steps)] };
}

/** Spherical-excess area in m², good enough for the hectare figures we report. */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 4) return 0;
  const toRad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (!a || !b) continue;
    total += (b[0] - a[0]) * toRad * (2 + Math.sin(a[1] * toRad) + Math.sin(b[1] * toRad));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

export function polygonAreaM2(coords: PolygonCoords): number {
  const outer = coords[0];
  if (!outer) return 0;
  let area = ringAreaM2(outer);
  for (let i = 1; i < coords.length; i++) {
    const hole = coords[i];
    if (hole) area -= ringAreaM2(hole);
  }
  return Math.max(0, area);
}

export function geometryAreaM2(geometry: GeoJSON.Geometry | null | undefined): number {
  if (!geometry) return 0;
  if (geometry.type === "Polygon") return polygonAreaM2(geometry.coordinates as PolygonCoords);
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as MultiPolygonCoords).reduce(
      (sum, poly) => sum + polygonAreaM2(poly),
      0,
    );
  }
  return 0;
}

export function centroidOf(points: Position[]): Position | null {
  if (points.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / points.length, lat / points.length];
}

/** Compass bearing in degrees from `a` to `b`, 0 = north. */
export function bearingDegrees(a: Position, b: Position): number {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

export function compassPoint(degrees: number): string {
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS[index] ?? "N";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  return lo !== undefined && hi !== undefined ? (lo + hi) / 2 : null;
}
