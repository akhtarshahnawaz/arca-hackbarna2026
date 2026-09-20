import { describe, expect, it } from "vitest";
import {
  bboxOfGeometry,
  bearingDegrees,
  circleRing,
  compassPoint,
  expandBBox,
  geometryAreaM2,
  haversineMeters,
  parseBBox,
  pointInGeometry,
  pointInRing,
} from "../src/geo/index.js";
import { square } from "./fixtures.js";

describe("geo", () => {
  it("measures a known distance", () => {
    // Barcelona to Manresa is about 50 km.
    const metres = haversineMeters([2.1734, 41.3851], [1.8261, 41.7286]);
    expect(metres).toBeGreaterThan(45_000);
    expect(metres).toBeLessThan(55_000);
  });

  it("counts a point on the boundary as inside", () => {
    const ring = square(0, 0, 1).coordinates[0]!;
    expect(pointInRing([0, 0], ring)).toBe(true);
    expect(pointInRing([1, 1], ring)).toBe(true);
    expect(pointInRing([2, 2], ring)).toBe(false);
  });

  it("excludes holes", () => {
    const withHole: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [square(0, 0, 2).coordinates[0]!, square(0, 0, 1).coordinates[0]!],
    };
    expect(pointInGeometry([1.5, 0], withHole)).toBe(true);
    expect(pointInGeometry([0, 0], withHole)).toBe(false);
  });

  it("expands a bbox by metres, not degrees", () => {
    const box = { minLon: 1, minLat: 41, maxLon: 1.1, maxLat: 41.1 };
    const wider = expandBBox(box, 1000);
    // One km of longitude at 41 N is more degrees than one km of latitude.
    expect(wider.minLon).toBeLessThan(box.minLon);
    expect(box.minLon - wider.minLon).toBeGreaterThan(box.minLat - wider.minLat);
  });

  it("builds a circle that is round on the ground", () => {
    const ring = circleRing([1.8, 41.7], 1000, 64);
    const distances = ring.map((p) => haversineMeters([1.8, 41.7], p));
    for (const d of distances) {
      expect(d).toBeGreaterThan(950);
      expect(d).toBeLessThan(1050);
    }
  });

  it("computes plausible polygon area", () => {
    // 0.01 degrees is roughly 1.1 km of latitude, so a 0.02-degree square
    // is a little over 2 km on a side: about 4-5 km².
    const area = geometryAreaM2(square(1.8, 41.7, 0.01));
    expect(area).toBeGreaterThan(3_000_000);
    expect(area).toBeLessThan(6_000_000);
  });

  it("reads bearings as compass points", () => {
    expect(compassPoint(bearingDegrees([0, 0], [0, 1]))).toBe("N");
    expect(compassPoint(bearingDegrees([0, 0], [1, 0]))).toBe("E");
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(180)).toBe("S");
  });

  it("round-trips a bbox parameter", () => {
    const box = parseBBox("0.15,40.50,3.35,42.90");
    expect(box.minLon).toBe(0.15);
    expect(box.maxLat).toBe(42.9);
    expect(() => parseBBox("nope")).toThrow();
  });

  it("finds the bbox of a multipolygon", () => {
    const box = bboxOfGeometry({
      type: "MultiPolygon",
      coordinates: [square(0, 0, 1).coordinates, square(5, 5, 1).coordinates],
    });
    expect(box).toEqual({ minLon: -1, minLat: -1, maxLon: 6, maxLat: 6 });
  });
});
