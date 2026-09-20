import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@arca/db";
import { bandsFromSimulation, type Incident, type Simulation, type TimelineEvent } from "@arca/core";
import { SpreadService } from "../src/pipeline/spread.js";

/**
 * What must survive a failed model run.
 *
 * A coordinator pressing "Re-run model" while DeepFire is busy must not end up
 * with worse information than they had. An earlier version returned the run
 * that had just failed, so the fallback saw a non-completed record and replaced
 * a ten-member ensemble with drawn circles: on screen, "9 of 10 runs" became
 * "1/1" and the ranked order changed, because a network call had failed.
 */

function simulation(): Simulation {
  const square = (h: number): GeoJSON.Polygon => ({
    type: "Polygon",
    coordinates: [[[1.8 - h, 41.7 - h], [1.8 + h, 41.7 - h], [1.8 + h, 41.7 + h], [1.8 - h, 41.7 + h], [1.8 - h, 41.7 - h]]],
  });
  const features = [];
  for (const hour of [1, 2, 3]) {
    features.push({ type: "Feature" as const, geometry: square(0.01 * hour), properties: { hour, burn_probability: 0.9 } });
  }
  return {
    id: "sim-good",
    status: "COMPLETED",
    ensembleMembers: 10,
    result: { type: "FeatureCollection", features },
    summary: { burnedAreaM2: 1_000_000, windSpeedAvgMs: 5, windDirectionAvg: 200 },
  };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    clusterId: "cluster-1",
    name: "Test fire",
    status: "confirmed",
    replay: false,
    position: [1.8, 41.7],
    firstObserved: "2026-09-19T12:00:00.000Z",
    lastObserved: "2026-09-19T13:00:00.000Z",
    confirmation: {
      score: 85, classification: "CONFIRMED", components: [],
      distinctSources: ["VIIRS_SNPP_NRT"], usableHotspots: 12, maxFrpMw: 90, maskedHotspots: 0,
    },
    weather: null,
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T13:00:00.000Z",
    ...overrides,
  };
}

function harness(deepfire: unknown) {
  const store = new MemoryStore();
  const events: TimelineEvent[] = [];
  const ctx = {
    store,
    deepfire,
    talaia: null,
    capabilities: {} as never,
    log: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
    async timeline(incidentId: string, kind: string, message: string) {
      const event = { id: `e${events.length}`, incidentId, at: new Date().toISOString(), kind, actor: "test", message } as TimelineEvent;
      events.push(event);
      return event;
    },
  };
  return { ctx: ctx as never, store, events };
}

/** A completed ten-member run already in the store. */
async function seedGoodRun(store: MemoryStore) {
  const sim = simulation();
  await store.saveSpreadRun({
    id: "run-good",
    incidentId: "inc-1",
    simulationId: sim.id,
    status: "COMPLETED",
    result: sim,
    bands: bandsFromSimulation(sim, { horizonHours: 3 }),
    ensembleMembers: 10,
    // Old enough that a non-forced call would want to refresh it.
    requestedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  });
}

describe("a failed refresh keeps the good run", () => {
  it("does not replace a ten-member ensemble with drawn circles", async () => {
    const deepfire = { createSimulation: vi.fn().mockRejectedValue(new Error("HTTP 503 from DeepFire")) };
    const { ctx, store, events } = harness(deepfire);
    await seedGoodRun(store);

    const service = new SpreadService(ctx);
    const outcome = await service.ensure(incident(), { force: true });

    expect(deepfire.createSimulation).toHaveBeenCalled();
    expect(outcome.synthetic).toBe(false);
    expect(outcome.simulation?.id).toBe("sim-good");
    expect(outcome.simulation?.ensembleMembers).toBe(10);
    // Drawn rings are flagged with a zero probability floor; real bands are not.
    expect(outcome.bands.features[0]?.properties.probabilityFloor).toBeGreaterThan(0);
    expect(events.some((e) => e.message.includes("Keeping the previous model run"))).toBe(true);
  });

  it("falls back to labelled rings only when there is no good run at all", async () => {
    const deepfire = { createSimulation: vi.fn().mockRejectedValue(new Error("HTTP 503")) };
    const { ctx } = harness(deepfire);

    const service = new SpreadService(ctx);
    const outcome = await service.ensure(incident());

    expect(outcome.synthetic).toBe(true);
    // Every consumer reads this flag to label the footprint a drawn circle.
    expect(outcome.bands.features.every((f) => f.properties.probabilityFloor === 0)).toBe(true);
  });
});

describe("replay incidents never reach the network", () => {
  it("serves the recorded run instead of calling the simulation API", async () => {
    const deepfire = { createSimulation: vi.fn() };
    const { ctx, store } = harness(deepfire);
    await seedGoodRun(store);

    const service = new SpreadService(ctx);
    const outcome = await service.ensure(incident({ replay: true }), { force: true });

    // A replay's cluster id is not a DeepFire UUID, so this call would fail —
    // and even succeeding would produce geometry unrelated to the recorded fire.
    expect(deepfire.createSimulation).not.toHaveBeenCalled();
    expect(outcome.simulation?.id).toBe("sim-good");
    expect(outcome.synthetic).toBe(false);
  });
});
