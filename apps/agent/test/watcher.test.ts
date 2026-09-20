import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@arca/db";
import { PlaceResolver, type Incident, type TimelineEvent } from "@arca/core";
import { Watcher } from "../src/pipeline/watcher.js";
import { ReplayService } from "../src/pipeline/replay.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The feed, and what ARCA does with it.
 *
 * The behaviour under test is the one an operator depends on and a unit test of
 * the cleaning rules cannot reach: that every active cluster appears in the
 * survey with the score that judged it, including — especially including — the
 * ones ARCA rejected, and that an operator can work one of those anyway.
 */

/** No test may reach Nominatim: slow, flaky, and rude to a donated service. */
function offlinePlaces() {
  return new PlaceResolver({ enabled: false });
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "..", "..", "..", "fixtures", "replay");

function feature(id: string, lon: number, lat: number, props: Record<string, unknown> = {}) {
  return {
    type: "Feature" as const,
    id,
    geometry: { type: "Point" as const, coordinates: [lon, lat] },
    properties: {
      first_observed: "2026-09-19T12:00:00Z",
      last_observed: "2026-09-19T12:40:00Z",
      active: true,
      ...props,
    },
  };
}

function hotspot(
  id: string,
  clusterId: string,
  lon: number,
  lat: number,
  source: string,
  confidence: string,
  minutesAgo = 20,
) {
  return {
    type: "Feature" as const,
    id,
    geometry: { type: "Point" as const, coordinates: [lon, lat] },
    properties: {
      cluster_id: clusterId,
      observed_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      source,
      confidence,
      fire_radiative_power: 45,
      country: "ES",
      active: true,
    },
  };
}

/**
 * Two clusters: one a coordinator would want to see, one a kiln.
 *
 * The strong cluster is six VIIRS pixels plus geostationary corroboration,
 * spaced a pixel apart so the duplicate rule leaves them alone. The weak one is
 * a single low-confidence MODIS pixel with nothing to back it up.
 */
function makeContext() {
  const store = new MemoryStore();
  const events: TimelineEvent[] = [];

  const strong = [];
  for (let i = 0; i < 6; i++) {
    strong.push(hotspot(`h${i}`, "strong", 1.8 + i * 0.006, 41.7 + i * 0.004, "VIIRS_NOAA20_NRT", "HIGH"));
  }
  for (let i = 0; i < 3; i++) {
    strong.push(hotspot(`g${i}`, "strong", 1.79 + i * 0.005, 41.71 + i * 0.003, "MTG_I1", "MEDIUM"));
  }

  const deepfire = {
    clusters: vi.fn(async () => [feature("clusters.strong", 1.81, 41.71), feature("clusters.weak", 2.4, 41.2)]),
    hotspots: vi.fn(async () => [...strong, hotspot("w0", "weak", 2.4, 41.2, "MODIS_NRT", "LOW")]),
    perimeters: vi.fn(async () => []),
    staticHeatSources: vi.fn(async () => []),
  };

  const ctx = {
    store,
    deepfire: deepfire as never,
    talaia: null,
    capabilities: {
      deepfire: true, talaia: false, nebius: false, slng: false,
      telegram: false, outboundCalls: false, database: false, exerciseMode: true,
    },
    log: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } } as never,
    async timeline(incidentId: string, kind: string, message: string) {
      const event = {
        id: `e${events.length}`, incidentId, at: new Date().toISOString(),
        kind, actor: "test", message,
      } as TimelineEvent;
      events.push(event);
      await store.addTimelineEvent(event);
      return event;
    },
  };

  return { ctx: ctx as never, store, events, deepfire };
}

describe("cluster survey", () => {
  it("reports every active cluster, including the ones it rejects", async () => {
    const { ctx } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    const survey = await watcher.survey();

    expect(survey.clusters).toHaveLength(2);
    const byId = new Map(survey.clusters.map((cluster) => [cluster.clusterId, cluster]));
    expect(byId.get("strong")!.classification).not.toBe("NOISE");
    expect(byId.get("weak")!.classification).toBe("NOISE");
  });

  it("explains why a rejected cluster kept nothing", async () => {
    const { ctx } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    const survey = await watcher.survey();
    const weak = survey.clusters.find((cluster) => cluster.clusterId === "weak")!;

    // A bare zero is indistinguishable from a broken pipeline. The count of
    // what arrived and the reason it was dropped are what make it readable.
    expect(weak.detections).toBe(0);
    expect(weak.rawDetections).toBe(1);
    expect(weak.dropped[0]?.reason).toMatch(/low confidence/i);
    expect(weak.sources).toEqual(["MODIS_NRT"]);
  });

  it("carries the corroborating satellites and the size of the thing", async () => {
    const { ctx } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    const strong = (await watcher.survey()).clusters.find((c) => c.clusterId === "strong")!;

    expect(strong.corroboratingSources.length).toBeGreaterThanOrEqual(2);
    expect(strong.spanM).toBeGreaterThan(0);
    expect(strong.confidence).toBe("HIGH");
  });

  it("serves a cached survey rather than re-querying on every poll", async () => {
    const { ctx, deepfire } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    await watcher.survey();
    await watcher.survey();
    await watcher.survey();

    expect(deepfire.clusters).toHaveBeenCalledTimes(1);
    await watcher.survey({ force: true });
    expect(deepfire.clusters).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good feed when a poll fails", async () => {
    const { ctx, deepfire } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    await watcher.survey();
    deepfire.clusters.mockRejectedValueOnce(new Error("upstream down"));
    const survey = await watcher.survey({ force: true });

    // Blanking a screen that was correct a minute ago is worse than showing
    // stale data beside the reason it is stale.
    expect(survey.error).toMatch(/upstream down/);
    expect(survey.clusters).toHaveLength(2);
  });

  it("links a cluster to the incident already working it", async () => {
    const { ctx, store } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    await watcher.adopt("strong");
    const survey = await watcher.survey({ force: true });
    const strong = survey.clusters.find((cluster) => cluster.clusterId === "strong")!;

    expect(strong.incidentId).toBeTruthy();
    expect(await store.getIncidentByCluster("strong")).toBeTruthy();
  });
});

describe("adopting a cluster", () => {
  it("opens one the watcher rejected, and records that a human asked", async () => {
    const { ctx, store, events } = makeContext();
    const started: Incident[] = [];
    const watcher = new Watcher(ctx, async (incident) => {
      started.push(incident);
    }, offlinePlaces());

    const incident = await watcher.adopt("weak");

    expect(incident).toBeTruthy();
    expect(await store.getIncidentByCluster("weak")).toBeTruthy();
    // The pipeline runs, because that is what the operator asked for.
    expect(started).toHaveLength(1);
    // And the timeline says it was opened below the bar, with the score.
    expect(events.some((event) => /below the noise threshold/i.test(event.message))).toBe(true);
  });

  it("does not re-open or re-announce a cluster already being worked", async () => {
    const { ctx, events } = makeContext();
    const started: Incident[] = [];
    const watcher = new Watcher(ctx, async (incident) => {
      started.push(incident);
    }, offlinePlaces());

    const first = await watcher.adopt("weak");
    const second = await watcher.adopt("weak");

    expect(second!.id).toBe(first!.id);
    expect(started).toHaveLength(1);
    expect(events.filter((event) => /below the noise threshold/i.test(event.message))).toHaveLength(1);
  });

  it("returns null for a cluster that has gone out", async () => {
    const { ctx } = makeContext();
    const watcher = new Watcher(ctx, async () => {}, offlinePlaces());

    expect(await watcher.adopt("no-such-cluster")).toBeNull();
  });
});

describe("scenario catalogue", () => {
  function replayContext() {
    const store = new MemoryStore();
    const ctx = {
      store,
      log: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } } as never,
      async timeline() {
        return {} as TimelineEvent;
      },
    };
    return { ctx: ctx as never, store };
  }

  it("describes each bundle well enough to choose between them", async () => {
    const { ctx } = replayContext();
    const replay = new ReplayService(ctx, fixturesDir);

    const scenarios = await replay.catalogue();

    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    for (const scenario of scenarios) {
      expect(scenario.label).not.toMatch(/^demo-/);
      expect(scenario.blurb.length).toBeGreaterThan(20);
      expect(scenario.detections).toBeGreaterThan(0);
      // Nothing generated may ever present itself as recorded satellite data.
      expect(scenario.synthetic).toBe(true);
    }
  });

  it("finds a bundle by the label an incident is named for", async () => {
    const { ctx } = replayContext();
    const replay = new ReplayService(ctx, fixturesDir);

    // Incidents are named for the operator, so the exposure fallback's only
    // handle on a replay is its label. If this breaks, every scenario silently
    // loses its bundled exposure.
    const [first] = await replay.catalogue();
    expect(await replay.resolveName(first!.label)).toBe(first!.name);
    expect(await replay.exposureFor(first!.label)).toBeTruthy();
  });

  it("refuses a name that would walk out of the fixtures directory", async () => {
    const { ctx } = replayContext();
    const replay = new ReplayService(ctx, fixturesDir);

    expect(await replay.load("../../package")).toBeNull();
    expect(await replay.load(join("..", "secrets"))).toBeNull();
  });
});
