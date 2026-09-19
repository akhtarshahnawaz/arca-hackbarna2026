import { describe, expect, it } from "vitest";
import { ellipseRing } from "@/lib/geo";
import { applyReportedConfirmations } from "@/lib/confirmations";
import { evacHoursForSite, rankSites } from "@/lib/ranking";
import type { HourPolygon, SiteInput } from "@/lib/types";

function farm(partial: Partial<SiteInput> & Pick<SiteInput, "id" | "code">): SiteInput {
  return {
    municipality: "Navàs",
    lon: 0.01,
    lat: 0,
    kind: "farm",
    animals: [{ species: "sheep", registeredCapacity: 400, confirmedCount: null }],
    hasOwnTransport: false,
    confirmedAt: null,
    capacityUpdatedAt: null,
    source: "registry",
    shelterHint: "POL-REC-08",
    notes: "",
    ...partial,
  };
}

function disks(): HourPolygon[] {
  const polygons: HourPolygon[] = [];
  for (let member = 0; member < 10; member += 1) {
    polygons.push({
      hour: 4,
      member,
      ring: ellipseRing([0, 0], 0.05, 0.05, 0),
    });
  }
  return polygons;
}

describe("reported confirmations", () => {
  it("labels coordinator logs as reported, not verified", () => {
    const sites = applyReportedConfirmations(
      [farm({ id: "rega-b-1842", code: "REGA-B-1842" })],
      [
        {
          siteId: "REGA-B-1842",
          species: "sheep",
          count: 200,
          hasTransport: true,
          reportedAt: "2026-09-19T13:00:00.000Z",
          source: "reported",
        },
      ],
    );

    expect(sites[0].confirmationStatus).toBe("reported");
    expect(sites[0].animals[0].confirmedCount).toBe(200);
    expect(sites[0].animals[0].registeredCapacity).toBe(400);
    expect(sites[0].hasOwnTransport).toBe(true);
  });

  it("recalculates ranking after a reported headcount", () => {
    const light = farm({
      id: "light",
      code: "REGA-LIGHT",
      lon: 0.01,
      animals: [{ species: "sheep", registeredCapacity: 100, confirmedCount: 100 }],
    });
    const heavy = farm({
      id: "heavy",
      code: "REGA-HEAVY",
      lon: 0.012,
      animals: [{ species: "sheep", registeredCapacity: 100, confirmedCount: 100 }],
    });

    const before = rankSites([light, heavy], disks(), {
      ensembleMembers: 10,
      horizonHours: 6,
    });
    expect(before.ranked.map((site) => site.code)).toEqual(["REGA-HEAVY", "REGA-LIGHT"]);

    const afterSites = applyReportedConfirmations([light, heavy], [
      {
        siteId: "REGA-HEAVY",
        species: "sheep",
        count: 800,
        hasTransport: false,
        reportedAt: "2026-09-19T13:05:00.000Z",
        source: "reported",
      },
    ]);

    expect(evacHoursForSite(afterSites[1])).toBeGreaterThan(evacHoursForSite(afterSites[0]));

    const after = rankSites(afterSites, disks(), {
      ensembleMembers: 10,
      horizonHours: 6,
    });
    expect(after.ranked[0].code).toBe("REGA-HEAVY");
    expect(after.ranked[0].confirmationStatus).toBe("reported");
    expect(after.ranked[0].spareTime).toBeLessThan(after.ranked[1].spareTime ?? 0);
  });
});
