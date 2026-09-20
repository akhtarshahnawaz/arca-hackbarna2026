import { describe, expect, it } from "vitest";
import {
  bandsFromSimulation,
  fallbackBands,
  isEnsemble,
  outerBand,
  probabilityAt,
  reachStats,
  spreadFrames,
  unionGeometries,
} from "../src/spread/bands.js";
import { geometryAreaM2 } from "../src/geo/index.js";
import { ensembleSimulation, singleRunSimulation, square } from "./fixtures.js";

describe("ensemble detection", () => {
  it("matches DeepFire's own test: any burn_probability below 1", () => {
    expect(isEnsemble(ensembleSimulation().result)).toBe(true);
    expect(isEnsemble(singleRunSimulation().result)).toBe(false);
    expect(isEnsemble(null)).toBe(false);
  });
});

describe("band construction", () => {
  it("emits one cumulative band per hour", () => {
    const bands = bandsFromSimulation(ensembleSimulation(), { horizonHours: 6 });
    expect(bands.features).toHaveLength(6);
    expect(bands.features.map((f) => f.properties.band)).toEqual([
      "t+1h", "t+2h", "t+3h", "t+4h", "t+5h", "t+6h",
    ]);
    expect(bands.features.map((f) => f.properties.minutes)).toEqual([60, 120, 180, 240, 300, 360]);
  });

  it("grows monotonically, so an earlier band is never larger", () => {
    const bands = bandsFromSimulation(ensembleSimulation());
    const areas = bands.features.map((f) => f.properties.areaM2);
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]!).toBeGreaterThanOrEqual(areas[i - 1]!);
    }
  });

  it("cuts the footprint at the probability floor", () => {
    const wide = bandsFromSimulation(ensembleSimulation(), { probabilityFloor: 0.05 });
    const narrow = bandsFromSimulation(ensembleSimulation(), { probabilityFloor: 0.9 });
    expect(outerBand(wide)!.properties.areaM2).toBeGreaterThan(
      outerBand(narrow)!.properties.areaM2,
    );
  });

  it("treats a single-member run as certainty", () => {
    const bands = bandsFromSimulation(singleRunSimulation());
    expect(bands.features).toHaveLength(6);
    expect(outerBand(bands)!.properties.areaM2).toBeGreaterThan(0);
  });

  it("returns nothing for a simulation with no result", () => {
    const bands = bandsFromSimulation({ id: "x", status: "NO_SPREAD", result: null });
    expect(bands.features).toHaveLength(0);
    expect(outerBand(bands)).toBeNull();
  });
});

describe("probability lookup", () => {
  const sim = ensembleSimulation();

  it("reads the highest contour covering the point", () => {
    // Centre sits inside every contour, so the 0.9 core wins.
    expect(probabilityAt([1.8, 41.7], sim, 6)).toBeCloseTo(0.9);
  });

  it("falls to an outer contour further from the centre", () => {
    // At hour 6 the 0.9 core is ±0.024 and the 0.5 ring is ±0.048.
    const p = probabilityAt([1.8 + 0.035, 41.7], sim, 6);
    expect(p).toBeCloseTo(0.5);
  });

  it("is zero outside the whole footprint", () => {
    expect(probabilityAt([2.5, 41.7], sim, 6)).toBe(0);
  });

  it("never decreases as the hour advances", () => {
    const point: [number, number] = [1.8 + 0.03, 41.7];
    let previous = 0;
    for (let hour = 1; hour <= 6; hour++) {
      const p = probabilityAt(point, sim, hour);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });
});

describe("reach statistics", () => {
  const sim = ensembleSimulation();

  it("converts probability into runs reaching", () => {
    const stats = reachStats([1.8, 41.7], sim, { ensembleMembers: 10 });
    expect(stats.runsTotal).toBe(10);
    expect(stats.runsReaching).toBe(9);
    expect(stats.singleRun).toBe(false);
  });

  it("reports the conservative arrival before the majority arrival", () => {
    const stats = reachStats([1.8 + 0.03, 41.7], sim, { ensembleMembers: 10 });
    expect(stats.arrivalMinutesP20).not.toBeNull();
    expect(stats.arrivalMinutesP50).not.toBeNull();
    expect(stats.arrivalMinutesP20!).toBeLessThanOrEqual(stats.arrivalMinutesP50!);
  });

  it("gives a point outside the fire no arrival at all", () => {
    const stats = reachStats([2.5, 41.7], sim, { ensembleMembers: 10 });
    expect(stats.pReach).toBe(0);
    expect(stats.arrivalMinutesP20).toBeNull();
    expect(stats.runsReaching).toBe(0);
  });

  it("marks a single-member run as one run, not ten", () => {
    const stats = reachStats([1.8, 41.7], singleRunSimulation());
    expect(stats.singleRun).toBe(true);
    expect(stats.runsTotal).toBe(1);
    expect(stats.runsReaching).toBe(1);
  });
});

describe("union", () => {
  it("merges overlapping squares into one footprint", () => {
    const merged = unionGeometries([square(0, 0, 1), square(0.5, 0, 1)]);
    expect(merged).not.toBeNull();
    const area = geometryAreaM2(merged!);
    const single = geometryAreaM2(square(0, 0, 1));
    // Overlapping: more than one square, less than two.
    expect(area).toBeGreaterThan(single);
    expect(area).toBeLessThan(single * 2);
  });

  it("keeps disjoint squares as separate parts", () => {
    const merged = unionGeometries([square(0, 0, 1), square(10, 10, 1)]);
    expect(merged!.coordinates).toHaveLength(2);
  });

  it("returns null for nothing", () => {
    expect(unionGeometries([])).toBeNull();
  });
});

describe("animation frames", () => {
  it("returns per-hour contours ordered by probability", () => {
    const frames = spreadFrames(ensembleSimulation());
    expect(frames).toHaveLength(6);
    const first = frames[0]!;
    expect(first.hour).toBe(1);
    expect(first.contours.map((c) => c.probability)).toEqual([0.1, 0.2, 0.5, 0.9]);
    expect(first.cumulativeAreaM2).toBeGreaterThan(0);
  });

  it("weights expected area by probability, as DeepFire's app does", () => {
    const frames = spreadFrames(ensembleSimulation());
    const frame = frames[5]!;
    // Expected area must be below the raw footprint, since most contours are
    // well under certainty.
    expect(frame.expectedAreaM2).toBeLessThan(frame.cumulativeAreaM2);
    expect(frame.expectedAreaM2).toBeGreaterThan(0);
  });

  it("grows cumulatively across frames", () => {
    const frames = spreadFrames(ensembleSimulation());
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.cumulativeAreaM2).toBeGreaterThanOrEqual(frames[i - 1]!.cumulativeAreaM2);
    }
  });
});

describe("fallback bands", () => {
  it("draws labelled rings when the model produced nothing", () => {
    const bands = fallbackBands([1.8, 41.7], { horizonHours: 3, metersPerHour: 500 });
    expect(bands.features).toHaveLength(3);
    // Every fallback band is explicitly floored at zero probability, which is
    // how the UI knows to label it as a drawn circle rather than model output.
    expect(bands.features.every((f) => f.properties.probabilityFloor === 0)).toBe(true);
    const areas = bands.features.map((f) => f.properties.areaM2);
    expect(areas[2]!).toBeGreaterThan(areas[0]!);
  });
});
