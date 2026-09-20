import { describe, expect, it } from "vitest";
import { cleanHotspots, confirmationScore } from "../src/cleaning/clean.js";
import { StaticSourceIndex } from "../src/cleaning/mask.js";
import { classifySensor, isGeostationary, sensorLabel } from "../src/cleaning/sources.js";
import { hotspot, square, staticSource } from "./fixtures.js";

const NOW = new Date("2026-09-19T13:00:00.000Z");

describe("sensor classification", () => {
  it("buckets every documented source", () => {
    expect(classifySensor("LANDSAT_NRT")).toBe("landsat");
    expect(classifySensor("VIIRS_NOAA21_NRT")).toBe("viirs");
    expect(classifySensor("SENTINEL_3A")).toBe("modis_class");
    expect(classifySensor("MTG_I1")).toBe("geostationary");
    expect(isGeostationary("METEOSAT_10")).toBe(true);
    expect(isGeostationary("VIIRS_SNPP_NRT")).toBe(false);
  });

  it("falls back on the name for an unknown code", () => {
    expect(classifySensor("VIIRS_NOAA25_FUTURE")).toBe("viirs");
    expect(classifySensor("something-else")).toBe("unknown");
    expect(sensorLabel("MODIS_NRT")).toContain("MODIS");
  });
});

describe("static heat source masking", () => {
  const index = new StaticSourceIndex([staticSource({ geometry: square(1.2, 41.18, 0.002) })]);

  it("masks a detection inside a refinery polygon", () => {
    const result = cleanHotspots([hotspot({ position: [1.2, 41.18] })], {
      staticIndex: index,
      now: NOW,
    });
    const first = result.hotspots[0]!;
    expect(first.usable).toBe(false);
    expect(first.flags).toContain("static_source");
    expect(first.reason).toContain("Tarragona refinery flare");
    expect(result.counts.static_source).toBe(1);
  });

  it("uses a wider radius for a coarse geostationary pixel", () => {
    // 0.02 degrees of longitude at 41 N is about 1.7 km from the polygon: far
    // outside a 200 m Landsat buffer, well inside a 3 km Meteosat one.
    const offset: [number, number] = [1.22, 41.18];
    const landsat = cleanHotspots([hotspot({ position: offset, source: "LANDSAT_NRT" })], {
      staticIndex: index,
      now: NOW,
    });
    const meteosat = cleanHotspots([hotspot({ position: offset, source: "METEOSAT_10" })], {
      staticIndex: index,
      now: NOW,
    });
    expect(landsat.hotspots[0]!.usable).toBe(true);
    expect(meteosat.hotspots[0]!.usable).toBe(false);
  });

  it("leaves a real fire far from any source alone", () => {
    const result = cleanHotspots([hotspot({ position: [1.8, 41.7] })], {
      staticIndex: index,
      now: NOW,
    });
    expect(result.hotspots[0]!.usable).toBe(true);
    expect(result.usable).toHaveLength(1);
  });
});

describe("confidence, duplicate and staleness rules", () => {
  it("drops an uncorroborated low-confidence pixel", () => {
    const result = cleanHotspots(
      [hotspot({ confidence: "LOW", clusterId: "c1", source: "MODIS_NRT" })],
      { now: NOW },
    );
    expect(result.hotspots[0]!.usable).toBe(false);
    expect(result.hotspots[0]!.flags).toContain("low_confidence_uncorroborated");
  });

  it("keeps a low-confidence pixel when its cluster has a high one", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "a", confidence: "LOW", clusterId: "c1", position: [1.8, 41.7] }),
        hotspot({ id: "b", confidence: "HIGH", clusterId: "c1", position: [1.85, 41.75] }),
      ],
      { now: NOW },
    );
    expect(result.usable).toHaveLength(2);
  });

  it("keeps a low-confidence pixel corroborated by a second satellite", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "a", confidence: "LOW", clusterId: "c1", source: "MODIS_NRT", position: [1.8, 41.7] }),
        hotspot({ id: "b", confidence: "MEDIUM", clusterId: "c1", source: "VIIRS_SNPP_NRT", position: [1.85, 41.75] }),
      ],
      { now: NOW },
    );
    expect(result.usable).toHaveLength(2);
  });

  it("collapses the same sensor re-reporting one pixel, keeping the stronger", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "a", observedAt: "2026-09-19T12:00:00Z", fireRadiativePowerMw: 80 }),
        hotspot({ id: "b", observedAt: "2026-09-19T12:05:00Z", fireRadiativePowerMw: 40 }),
      ],
      { now: NOW },
    );
    const kept = result.usable.map((h) => h.id);
    expect(kept).toEqual(["a"]);
    expect(result.hotspots.find((h) => h.id === "b")!.flags).toContain("duplicate");
  });

  it("does not collapse detections from different satellites", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "a", source: "VIIRS_SNPP_NRT", observedAt: "2026-09-19T12:00:00Z" }),
        hotspot({ id: "b", source: "VIIRS_NOAA20_NRT", observedAt: "2026-09-19T12:05:00Z" }),
      ],
      { now: NOW },
    );
    expect(result.usable).toHaveLength(2);
  });

  it("marks old detections stale without deleting them", () => {
    const result = cleanHotspots([hotspot({ observedAt: "2026-09-18T12:00:00Z" })], { now: NOW });
    expect(result.hotspots).toHaveLength(1);
    expect(result.hotspots[0]!.flags).toContain("stale");
    expect(result.usable).toHaveLength(0);
  });
});

describe("confirmation score", () => {
  it("confirms a multi-satellite, persistent, energetic fire", () => {
    const cleaned = cleanHotspots(
      [
        hotspot({ id: "a", source: "VIIRS_SNPP_NRT", observedAt: "2026-09-19T12:00:00Z", fireRadiativePowerMw: 120 }),
        hotspot({ id: "b", source: "MTG_I1", observedAt: "2026-09-19T12:40:00Z", fireRadiativePowerMw: 90 }),
      ],
      { now: NOW },
    );
    const score = confirmationScore(cleaned, { hasPerimeter: true });
    expect(score.classification).toBe("CONFIRMED");
    expect(score.score).toBeGreaterThanOrEqual(60);
    expect(score.components.map((c) => c.key)).toContain("multi_source");
    expect(score.components.map((c) => c.key)).toContain("persistence");
    expect(score.distinctSources).toHaveLength(2);
  });

  it("penalises a geostationary-only cluster", () => {
    const cleaned = cleanHotspots(
      [
        hotspot({ id: "a", source: "MTG_I1", observedAt: "2026-09-19T12:00:00Z" }),
        hotspot({ id: "b", source: "METEOSAT_10", observedAt: "2026-09-19T12:40:00Z" }),
      ],
      { now: NOW },
    );
    const score = confirmationScore(cleaned);
    expect(score.components.map((c) => c.key)).toContain("geostationary_only");
    expect(score.score).toBeLessThan(
      confirmationScore(
        cleanHotspots(
          [
            hotspot({ id: "a", source: "VIIRS_SNPP_NRT", observedAt: "2026-09-19T12:00:00Z" }),
            hotspot({ id: "b", source: "MODIS_NRT", observedAt: "2026-09-19T12:40:00Z" }),
          ],
          { now: NOW },
        ),
      ).score,
    );
  });

  it("scores a fully masked cluster as noise", () => {
    const index = new StaticSourceIndex([staticSource({ geometry: square(1.2, 41.18, 0.002) })]);
    const cleaned = cleanHotspots(
      [hotspot({ position: [1.2, 41.18] }), hotspot({ position: [1.2001, 41.1801] })],
      { staticIndex: index, now: NOW },
    );
    const score = confirmationScore(cleaned);
    expect(score.classification).toBe("NOISE");
    expect(score.score).toBe(0);
    expect(score.components[0]!.key).toBe("all_masked");
  });

  it("leaves a single weak polar detection as a candidate, not confirmed", () => {
    const cleaned = cleanHotspots(
      [hotspot({ confidence: "MEDIUM", fireRadiativePowerMw: 25, observedAt: "2026-09-19T12:50:00Z" })],
      { now: NOW },
    );
    const score = confirmationScore(cleaned);
    expect(score.classification).toBe("CANDIDATE");
  });
});

describe("duplicate radius scales with the sensor", () => {
  it("keeps adjacent VIIRS pixels of one large fire as separate detections", () => {
    // 300 m apart: two neighbouring 375 m pixels along a real fire front.
    const result = cleanHotspots(
      [
        hotspot({ id: "a", source: "VIIRS_SNPP_NRT", position: [1.8, 41.7], observedAt: "2026-09-19T12:00:00Z" }),
        hotspot({ id: "b", source: "VIIRS_SNPP_NRT", position: [1.80361, 41.7], observedAt: "2026-09-19T12:01:00Z" }),
      ],
      { now: NOW },
    );
    expect(result.usable).toHaveLength(2);
  });

  it("still collapses a re-report of the same coarse Meteosat pixel", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "a", source: "METEOSAT_10", position: [1.8, 41.7], observedAt: "2026-09-19T12:00:00Z" }),
        hotspot({ id: "b", source: "METEOSAT_10", position: [1.80361, 41.7], observedAt: "2026-09-19T12:01:00Z" }),
      ],
      { now: NOW },
    );
    expect(result.usable).toHaveLength(1);
  });

  it("keeps the higher-confidence detection when two report the same pixel", () => {
    const result = cleanHotspots(
      [
        hotspot({ id: "low", confidence: "LOW", fireRadiativePowerMw: 99, observedAt: "2026-09-19T12:00:00Z" }),
        hotspot({ id: "high", confidence: "HIGH", fireRadiativePowerMw: 40, observedAt: "2026-09-19T12:01:00Z" }),
      ],
      { now: NOW },
    );
    expect(result.usable.map((h) => h.id)).toEqual(["high"]);
  });
});
