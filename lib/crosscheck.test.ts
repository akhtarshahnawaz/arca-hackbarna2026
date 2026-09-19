import { describe, expect, it } from "vitest";
import {
  checkHotspots,
  corroborateSites,
  corroborationCopy,
  isCorroborated,
  isWeakDetection,
  mostUrgent,
  sortByCorroboration,
  staticHeatAt,
} from "@/lib/crosscheck";
import { looksLikeFirmsCsv, parseFirmsCsv, readInstant } from "@/lib/fire-feeds";
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
    rings: [
      [
        [lon - half, lat - half],
        [lon + half, lat - half],
        [lon + half, lat + half],
        [lon - half, lat + half],
        [lon - half, lat - half],
      ],
    ],
  };
}

/** A mapped source with no usable ring — the only case the centroid covers. */
function unmapped(lat: number, lon: number): HeatSource {
  return { ...squareAround(lat, lon), id: "heat-unmapped", rings: [] };
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

describe("checkHotspots fails closed", () => {
  it("refuses a match on an unreadable timestamp instead of skipping the age test", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1", observedAt: "2026-09-19T10:00:00Z" })],
      // What an epoch-millis or DD/MM/YYYY field used to become.
      [detection({ id: "effis-bad", feed: "effis", observedAt: "1758278400000" })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
    expect(isCorroborated(checked)).toBe(false);
  });

  it("still allows a match when a feed publishes no timestamp at all", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "effis-undated", feed: "effis", observedAt: null })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire", "effis"]);
  });

  it("ignores a low-confidence pixel", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-glint", confidence: "l" })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
  });

  it("ignores a MODIS detection below the confidence floor", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-modis", confidence: "12" })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
  });

  it("never promotes a hotspot while the chimney mask is unavailable", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "firms-1" })],
      [],
      false,
    );

    expect(checked.confirmedBy).toEqual(["deepfire", "firms"]);
    expect(checked.staticHeat).toBeNull();
    // Two feeds agree, but nobody can say whether they agree about a chimney.
    expect(isCorroborated(checked)).toBe(false);
    expect(corroborateSites([ranked({ id: "s1", code: "R-1" })], [checked])[0].corroboration).toBeNull();
  });

  it("drops a detection whose coordinates are not finite", () => {
    const [checked] = checkHotspots(
      [hotspot({ id: "df-1" })],
      [detection({ id: "effis-nan", feed: "effis", lat: Number.NaN, lon: Number.NaN })],
    );

    expect(checked.confirmedBy).toEqual(["deepfire"]);
  });
});

describe("isWeakDetection", () => {
  it("rejects low and keeps nominal, high and ungraded", () => {
    expect(isWeakDetection("l")).toBe(true);
    expect(isWeakDetection("LOW")).toBe(true);
    expect(isWeakDetection("n")).toBe(false);
    expect(isWeakDetection("h")).toBe(false);
    expect(isWeakDetection(null)).toBe(false);
    expect(isWeakDetection("80")).toBe(false);
  });
});

describe("mostUrgent", () => {
  it("finds the site soonest out of time after the cross-check re-sort", () => {
    const rows = [
      ranked({ id: "s1", code: "CALM", rank: 1, timeRank: 3, spareTime: 4 }),
      ranked({ id: "s2", code: "LATE", rank: 2, timeRank: 1, spareTime: -2 }),
    ];

    expect(rows[0].code).toBe("CALM");
    expect(mostUrgent(rows)?.code).toBe("LATE");
  });

  it("falls back to the display rank when nothing stamped a clock rank", () => {
    expect(mostUrgent([ranked({ id: "s1", code: "A", rank: 2 }), ranked({ id: "s2", code: "B", rank: 1 })])?.code).toBe("B");
  });
});

describe("staticHeatAt", () => {
  it("matches a point inside the mask polygon", () => {
    expect(staticHeatAt({ lat: 41.73, lon: 1.83 }, [squareAround(41.73, 1.83)])).not.toBeNull();
  });

  it("returns null for a point well outside it", () => {
    expect(staticHeatAt({ lat: 41.9, lon: 2.4 }, [squareAround(41.73, 1.83)])).toBeNull();
  });

  it("does not throw a centroid circle around a source the polygon already cleared", () => {
    // ~870 m east of the centroid: outside the mapped ring, inside the 1 km
    // centroid tolerance. A real fire here, not a quarry.
    expect(staticHeatAt({ lat: 41.73, lon: 1.8405 }, [squareAround(41.73, 1.83)])).toBeNull();
  });

  it("still falls back to the centroid for a source with no usable ring", () => {
    expect(staticHeatAt({ lat: 41.7331, lon: 1.83 }, [unmapped(41.73, 1.83)])).not.toBeNull();
  });

  it("matches a point in any part of a multi-part source", () => {
    const twoKilns: HeatSource = {
      ...squareAround(41.73, 1.83),
      rings: [...squareAround(41.73, 1.83).rings, ...squareAround(41.9, 2.4).rings],
    };

    expect(staticHeatAt({ lat: 41.9, lon: 2.4 }, [twoKilns])).not.toBeNull();
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

describe("looksLikeFirmsCsv", () => {
  it("accepts the real CSV, with or without a byte-order mark", () => {
    expect(looksLikeFirmsCsv("latitude,longitude,acq_date\n41.7,1.8,2026-09-19")).toBe(true);
    expect(looksLikeFirmsCsv("\uFEFFlatitude,longitude\n41.7,1.8")).toBe(true);
  });

  it("rejects the prose FIRMS answers a bad key or a spent quota with", () => {
    expect(looksLikeFirmsCsv("Invalid MAP_KEY.")).toBe(false);
    expect(looksLikeFirmsCsv("You have exceeded your transaction limit.")).toBe(false);
    expect(looksLikeFirmsCsv("")).toBe(false);
  });
});

describe("firms acq_time", () => {
  it("returns no observation time rather than inventing midnight", () => {
    const csv = [
      "latitude,longitude,acq_date,acq_time,confidence",
      "41.7312,1.8329,2026-09-19,,n",
    ].join("\n");

    expect(parseFirmsCsv(csv, "VIIRS_SNPP_NRT")[0].observedAt).toBeNull();
  });
});

describe("readInstant", () => {
  it("reads ISO, epoch seconds and epoch milliseconds", () => {
    expect(readInstant({ t: "2026-09-19T10:00:00Z" }, ["t"])).toBe("2026-09-19T10:00:00.000Z");
    expect(readInstant({ t: 1789768800 }, ["t"])).toBe(new Date(1789768800000).toISOString());
    expect(readInstant({ t: 1789768800000 }, ["t"])).toBe(new Date(1789768800000).toISOString());
    expect(readInstant({ t: "1789768800000" }, ["t"])).toBe(new Date(1789768800000).toISOString());
  });

  it("returns null for a value it cannot read", () => {
    expect(readInstant({ t: "not a date" }, ["t"])).toBeNull();
    expect(readInstant({}, ["t"])).toBeNull();
  });
});
