import { describe, expect, it } from "vitest";
import { ellipseRing } from "@/lib/geo";
import {
  ensembleReachCopy,
  evacHoursForSite,
  rankSites,
  reachLabel,
  spareTimeCopy,
} from "@/lib/ranking";
import type { HourPolygon, SiteInput } from "@/lib/types";

function site(partial: Partial<SiteInput> & Pick<SiteInput, "id" | "code" | "kind">): SiteInput {
  return {
    municipality: "Navàs",
    lon: 1.83,
    lat: 41.73,
    animals: [],
    hasOwnTransport: null,
    confirmedAt: null,
    capacityUpdatedAt: null,
    source: "demo",
    shelterHint: "POL-REC-08",
    notes: "",
    ...partial,
  };
}

function growingDisks(): HourPolygon[] {
  const polygons: HourPolygon[] = [];
  for (let member = 0; member < 10; member += 1) {
    for (let hour = 1; hour <= 6; hour += 1) {
      const scale = member < 7 ? 1 : 0.55;
      polygons.push({
        hour,
        member,
        ring: ellipseRing([1.82, 41.72], 0.012 * hour * scale, 0.012 * hour * scale, 0),
      });
    }
  }
  return polygons;
}

describe("ranking", () => {
  it("puts a negative spare_time site first", () => {
    const care = site({
      id: "care",
      code: "R-CARE-041",
      kind: "care_home",
      lon: 1.844,
      lat: 41.736,
    });
    const house = site({
      id: "house",
      code: "HH-PET-07",
      kind: "household",
      lon: 1.828,
      lat: 41.726,
      hasOwnTransport: false,
      animals: [{ species: "dogs", registeredCapacity: 2, confirmedCount: 2 }],
    });

    const { ranked } = rankSites([house, care], growingDisks());
    expect(ranked[0].code).toBe("R-CARE-041");
    expect(ranked[0].spareTime).not.toBeNull();
    expect(ranked[0].spareTime as number).toBeLessThan(0);
  });

  it("tie-breaks equal spare_time by higher p_reach", () => {
    const polygons: HourPolygon[] = [];
    for (let member = 0; member < 10; member += 1) {
      const radius = member < 7 ? 0.06 : 0.015;
      polygons.push({
        hour: 3,
        member,
        ring: ellipseRing([0, 0], radius, radius, 0),
      });
    }

    const likely = site({
      id: "a",
      code: "A",
      kind: "school",
      lon: 0.008,
      lat: 0,
    });
    const alsoMain = site({
      id: "b",
      code: "B",
      kind: "school",
      lon: 0.04,
      lat: 0,
    });

    const { ranked } = rankSites([alsoMain, likely], polygons, {
      ensembleMembers: 10,
      horizonHours: 6,
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0].tEvac).toBe(ranked[1].tEvac);
    expect(ranked[0].spareTime).toBe(ranked[1].spareTime);
    expect(ranked[0].pReach).toBeGreaterThan(ranked[1].pReach);
    expect(ranked[0].code).toBe("A");
  });

  it("keeps a watch site with worse spare_time out of the main ranking", () => {
    const polygons: HourPolygon[] = [];
    for (let member = 0; member < 10; member += 1) {
      if (member === 0) {
        polygons.push({
          hour: 1,
          member,
          ring: ellipseRing([0, 0], 0.08, 0.08, 0),
        });
      } else {
        polygons.push({
          hour: 5,
          member,
          ring: ellipseRing([0, 0], 0.02, 0.02, 0),
        });
      }
    }

    const watchCare = site({
      id: "care-watch",
      code: "R-CARE-NOISE",
      kind: "care_home",
      lon: 0.05,
      lat: 0,
    });
    const likelyFarm = site({
      id: "farm",
      code: "REGA-LIKELY",
      kind: "farm",
      lon: 0.01,
      lat: 0,
      animals: [{ species: "sheep", registeredCapacity: 100, confirmedCount: 100 }],
    });

    const { ranked, watch } = rankSites([watchCare, likelyFarm], polygons, {
      ensembleMembers: 10,
      horizonHours: 6,
    });

    expect(watchCare.kind).toBe("care_home");
    expect(ranked.map((item) => item.code)).toEqual(["REGA-LIKELY"]);
    expect(ranked[0].pReach).toBeGreaterThanOrEqual(0.3);
    expect(watch).toHaveLength(1);
    expect(watch[0].code).toBe("R-CARE-NOISE");
    expect(watch[0].pReach).toBe(0.1);
    expect(watch[0].label).toBe("watch");
    expect(watch[0].spareTime).not.toBeNull();
    expect(watch[0].spareTime as number).toBeLessThan(ranked[0].spareTime ?? 0);
  });

  it("lets a possible care home compete with a likely farm", () => {
    const polygons: HourPolygon[] = [];
    for (let member = 0; member < 10; member += 1) {
      const radius = member < 3 ? 0.06 : 0.02;
      polygons.push({
        hour: member < 3 ? 2 : 5,
        member,
        ring: ellipseRing([0, 0], radius, radius, 0),
      });
    }

    const possibleCare = site({
      id: "care-possible",
      code: "R-CARE-3",
      kind: "care_home",
      lon: 0.04,
      lat: 0,
    });
    const likelyFarm = site({
      id: "farm-9",
      code: "REGA-9",
      kind: "farm",
      lon: 0.01,
      lat: 0,
      animals: [{ species: "sheep", registeredCapacity: 100, confirmedCount: 100 }],
    });

    const { ranked, watch } = rankSites([likelyFarm, possibleCare], polygons, {
      ensembleMembers: 10,
      horizonHours: 6,
    });

    expect(watch).toHaveLength(0);
    expect(ranked).toHaveLength(2);
    expect(ranked.find((item) => item.code === "R-CARE-3")?.pReach).toBe(0.3);
    expect(ranked.find((item) => item.code === "REGA-9")?.pReach).toBe(1);
    expect(ranked[0].code).toBe("R-CARE-3");
    expect(ranked[0].label).toBe("possible");
    expect(ranked[1].label).toBe("likely");
  });

  it("labels reach bands and writes ensemble copy", () => {
    expect(reachLabel(0.8)).toBe("likely");
    expect(reachLabel(0.4)).toBe("possible");
    expect(reachLabel(0.1)).toBe("watch");
    expect(ensembleReachCopy(7, 10, 3)).toBe(
      "In 7 of 10 runs, fire reaches within 3 h",
    );
  });

  it("explains negative spare_time as already behind", () => {
    const copy = spareTimeCopy(-1);
    expect(copy).toMatch(/already behind/i);
    expect(copy).toMatch(/not an order to leave/i);
  });

  it("uses confirmed counts for farm evac time when present", () => {
    const farm = site({
      id: "farm",
      code: "REGA-B-1842",
      kind: "farm",
      animals: [{ species: "sheep", registeredCapacity: 400, confirmedCount: 200 }],
    });
    expect(evacHoursForSite(farm)).toBe(2.5);
  });
});
