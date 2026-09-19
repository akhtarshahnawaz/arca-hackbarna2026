import { describe, expect, it } from "vitest";
import {
  checkHotspots,
  corroborateSites,
  corroborationCopy,
  isCorroborated,
  sortByCorroboration,
  staticHeatAt,
} from "@/lib/crosscheck";
import { parseFirmsCsv } from "@/lib/fire-feeds";
import type { FeedDetection, HeatSource, Hotspot, RankedSite } from "@/lib/types";

function hotspot(partial: Partial<Hotspot> & Pick<Hotspot, "id">): Hotspot {
  return {
    lat: 41.73,
    lon: 1.83,
    observedAt: "2026-09-19T10:00:00Z",
    clusterId: null,
    confidence: "high",
    country: "ES",
    ...partial,
  };
}

function detection(partial: Partial<FeedDetection> & Pick<FeedDetection, "id">): FeedDetection {
  return {
    feed: "firms",
    lat: 41.73,
    lon: 1.83,
    observedAt: "2026-09-19T11:00:00Z",
    confidence: "n",
    ...partial,
  };
}

function ranked(partial: Partial<RankedSite> & Pick<RankedSite, "id" | "code">): RankedSite {
  return {
    kind: "farm",
    municipality: "Navàs",
    lat: 41.73,
    lon: 1.83,
    animals: [],
    hasOwnTransport: null,
    confirmedAt: null,
    capacityUpdatedAt: null,
    source: "demo",
    shelterHint: "POL-REC-08",
    notes: "",
    rank: 1,
    pReach: 1,
    runsReach: 10,
    ensembleMembers: 10,
    tArrival: 3,
    tEvac: 2,
    spareTime: 1,
    label: "likely",
    arrivalHours: [3],
    protectiveAction: null,
    ...partial,
  } as RankedSite;
}

function squareAround(lat: number, lon: number, half = 0.01): HeatSource {
  return {
    id: "heat-1",
    label: "Nonmetal-mineral",
    type: "Thermal anomaly",
    remarks: "Nonmetal-mineral",
    source: "Liu et al 2018",
    year: 2016,
    lat,
    lon,
    ring: [
      [lon - half, lat - half],
      [lon + half, lat - half],
      [lon + half, lat + half],
      [lon - half, lat + half],
      [lon - half, lat - half],
    ],
  };
}

describe("checkHotspots", () => {
  it("confirms a hotspot a second feed saw nearby and recently", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-1", lat: 41.735, lon: 1.833 })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire", "firms"]);
    expect(checked.matchKm).toBeLessThan(1);
    expect(isCorroborated(checked)).toBe(true);
  });

  it("leaves a hotspot single-source when the other feed is far away", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-far", lat: 42.5, lon: 2.6 })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
    expect(checked.matchKm).toBeNull();
    expect(isCorroborated(checked)).toBe(false);
  });

  it("leaves a hotspot single-source when the other feed saw it days earlier", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1", observedAt: "2026-09-19T10:00:00Z" })],
      [detection({ id: "firms-old", observedAt: "2026-09-10T10:00:00Z" })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
  });

  it("counts a third feed separately", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [
        detection({ id: "firms-1" }),
        detection({ id: "effis-1", feed: "effis", lat: 41.731, lon: 1.831 }),
      ],
    );

    expect(checked.confirmedBy).toEqual(["deepfire", "firms", "effis"]);
  });

  it("names the static heat source a hotspot sits on", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-1" })],
      [squareAround(41.73, 1.83)],
    );

    expect(checked.staticHeat).toBe("Nonmetal-mineral");
    // Two feeds agree, but they agree about a chimney.
    expect(isCorroborated(checked)).toBe(false);
  });
});

describe("staticHeatAt", () => {
  it("matches a point inside the mask polygon", () => {
    expect(staticHeatAt({ lat: 41.73, lon: 1.83 }, [squareAround(41.73, 1.83)])).not.toBeNull();
  });

  it("returns null for a point well outside it", () => {
    expect(staticHeatAt({ lat: 41.9, lon: 2.4 }, [squareAround(41.73, 1.83)])).toBeNull();
  });
});

describe("corroborateSites", () => {
  it("hangs the nearest corroborated hotspot on the site", () => {
    const checked = checkHotspots(
      [hotspot({ id: "df-1", lat: 41.75, lon: 1.85 })],
      [detection({ id: "firms-1", lat: 41.75, lon: 1.85 })],
    );
    const [site] = corroborateSites([ranked({ id: "s1", code: "R-1" })], checked);

    expect(site.corroboration?.feeds).toEqual(["deepfire", "firms"]);
    expect(site.corroboration?.km).toBeLessThan(5);
    expect(corroborationCopy(site)).toContain("NASA FIRMS");
  });

  it("leaves a site alone when the corroborated fire is beyond the radius", () => {
    const checked = checkHotspots(
      [hotspot({ id: "df-1", lat: 42.6, lon: 2.9 })],
      [detection({ id: "firms-1", lat: 42.6, lon: 2.9 })],
    );
    const [site] = corroborateSites([ranked({ id: "s1", code: "R-1" })], checked);

    expect(site.corroboration).toBeNull();
    expect(corroborationCopy(site)).toBeNull();
  });
});

describe("sortByCorroboration", () => {
  it("puts corroborated sites first and keeps the clock order inside a level", () => {
    const checked = checkHotspots(
      [hotspot({ id: "df-1", lat: 41.9, lon: 2.1 })],
      [detection({ id: "firms-1", lat: 41.9, lon: 2.1 })],
    );
    const sites = corroborateSites(
      [
        ranked({ id: "s1", code: "LATE", spareTime: -2, lat: 41.6, lon: 1.6 }),
        ranked({ id: "s2", code: "CALM", spareTime: 4, lat: 41.9, lon: 2.1 }),
        ranked({ id: "s3", code: "SOON", spareTime: 1, lat: 41.6, lon: 1.6 }),
      ],
      checked,
    );

    expect(sortByCorroboration(sites).map((site) => site.code)).toEqual(["CALM", "LATE", "SOON"]);
  });

  it("is a no-op when nothing is corroborated", () => {
    const sites = corroborateSites(
      [ranked({ id: "s1", code: "A" }), ranked({ id: "s2", code: "B" })],
      [],
    );

    expect(sortByCorroboration(sites).map((site) => site.code)).toEqual(["A", "B"]);
  });
});

describe("parseFirmsCsv", () => {
  it("reads coordinates and builds a UTC timestamp from acq_date and acq_time", () => {
    const csv = [
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
      "41.7312,1.8329,330.1,0.4,0.4,2026-09-19,0413,N20,VIIRS,n,2.0NRT,295.3,4.2,N",
    ].join("\n");

    expect(parseFirmsCsv(csv, "VIIRS_NOAA20_NRT")).toEqual([
      {
        id: "firms-VIIRS_NOAA20_NRT-0-41.7312,1.8329",
        feed: "firms",
        lat: 41.7312,
        lon: 1.8329,
        observedAt: "2026-09-19T04:13:00Z",
        confidence: "n",
      },
    ]);
  });

  it("returns nothing for an empty or header-only response", () => {
    expect(parseFirmsCsv("", "VIIRS_SNPP_NRT")).toEqual([]);
    expect(parseFirmsCsv("latitude,longitude,acq_date,acq_time\n", "VIIRS_SNPP_NRT")).toEqual([]);
  });
});
