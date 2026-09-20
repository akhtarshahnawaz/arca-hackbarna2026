import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@arca/db";
import type { ExposureReport, Incident, Simulation, TimelineEvent } from "@arca/core";
import { ExposureService } from "../src/pipeline/exposure.js";
import { IncidentService } from "../src/pipeline/incident.js";
import { bandsFromSimulation } from "@arca/core";

/**
 * End-to-end pipeline, with the two external systems stubbed.
 *
 * This is the test that would have caught the failure the previous build
 * shipped with: a re-rank silently discarding what a phone call established.
 * Everything between bands and a ranked list runs for real.
 */

function ensembleSimulation(): Simulation {
  const square = (halfSize: number): GeoJSON.Polygon => ({
    type: "Polygon",
    coordinates: [
      [
        [1.8 - halfSize, 41.7 - halfSize],
        [1.8 + halfSize, 41.7 - halfSize],
        [1.8 + halfSize, 41.7 + halfSize],
        [1.8 - halfSize, 41.7 + halfSize],
        [1.8 - halfSize, 41.7 - halfSize],
      ],
    ],
  });
  const features = [];
  for (const hour of [1, 2, 3, 4, 5, 6]) {
    features.push(
      { type: "Feature" as const, geometry: square(0.005 * hour), properties: { hour, burn_probability: 0.9 } },
      { type: "Feature" as const, geometry: square(0.012 * hour), properties: { hour, burn_probability: 0.4 } },
    );
  }
  return {
    id: "sim-test",
    status: "COMPLETED",
    ensembleMembers: 10,
    durationHours: 6,
    result: { type: "FeatureCollection", features },
    summary: { burnedAreaM2: 2_000_000, windSpeedAvgMs: 7, windDirectionAvg: 300 },
  };
}

function exposureReport(): ExposureReport {
  return {
    summary: {
      asset_count: 3,
      people_estimate: 428,
      population_resident: 1200,
      total_value_eur: 12_000_000,
      critical_assets: 2,
      hazardous_assets: 1,
      coverage_regime: "catalonia_full",
    },
    bands: [],
    warnings: [],
    assets: [
      {
        id: "care-1",
        category: "social_care",
        subcategory: "care_home",
        name: "Residència Els Companys",
        geometry: { type: "Point", coordinates: [1.8, 41.7] },
        capacity: { places: 64, people: 64, basis: "RESES", confidence: 0.7 },
        contacts: { phone: ["+34938741122"], email: [], operator: null },
        valuation: { total_eur: 4_000_000, method: "default_footprint", confidence: 0.3 },
        criticality: 100,
        vulnerability: 75,
        human_bearing: true,
        exposure: { band: "t+1h", band_minutes: 60, inside_aoi: true, priority_score: 88 },
        provenance: [{ source_id: "es.cat.reses" }],
      },
      {
        id: "school-1",
        category: "education",
        subcategory: "primary_school",
        name: "Escola Pia",
        geometry: { type: "Point", coordinates: [1.804, 41.703] },
        capacity: { places: 300, people: 300, basis: "enrolment", confidence: 0.8 },
        contacts: { phone: ["+34938740000"], email: [], operator: null },
        valuation: { total_eur: 6_000_000, method: "measured_footprint", confidence: 0.8 },
        criticality: 95,
        vulnerability: 70,
        human_bearing: true,
        exposure: { band: "t+2h", band_minutes: 120, inside_aoi: true, priority_score: 80 },
        provenance: [{ source_id: "es.cat.schools" }],
      },
      {
        id: "fuel-1",
        category: "industry",
        subcategory: "fuel_station",
        name: "Estació de servei Km 12",
        geometry: { type: "Point", coordinates: [1.802, 41.701] },
        capacity: { places: 0, people: 0, basis: "n/a", confidence: 0.5 },
        contacts: { phone: [], email: [], operator: null },
        valuation: { total_eur: 2_000_000, method: "class_default", confidence: 0.3 },
        criticality: 60,
        vulnerability: 90,
        hazardous: true,
        human_bearing: false,
        exposure: { band: "t+1h", band_minutes: 60, inside_aoi: true, priority_score: 70 },
        provenance: [{ source_id: "osm" }],
      },
    ],
  };
}

function makeContext(exposure: ExposureReport = exposureReport()) {
  const store = new MemoryStore();
  const events: TimelineEvent[] = [];
  const talaia = { exposure: vi.fn(async () => exposure) };

  const ctx = {
    store,
    deepfire: null,
    talaia: talaia as never,
    capabilities: {
      deepfire: false, talaia: true, nebius: false, slng: false,
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

  return { ctx: ctx as never, store, events, talaia };
}

function incident(): Incident {
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
      distinctSources: ["VIIRS_SNPP_NRT", "MTG_I1"], usableHotspots: 24,
      maxFrpMw: 120, maskedHotspots: 3,
    },
    weather: null,
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-19T13:00:00.000Z",
  };
}

describe("exposure to ranking", () => {
  let harness: ReturnType<typeof makeContext>;
  let service: ExposureService;
  const simulation = ensembleSimulation();
  const bands = bandsFromSimulation(simulation, { horizonHours: 6 });

  beforeEach(() => {
    harness = makeContext();
    service = new ExposureService(harness.ctx);
  });

  it("ranks the exposed sites and stores them", async () => {
    const result = await service.rankIncident(incident(), bands, simulation);
    expect(result.ranking).not.toBeNull();
    expect(result.ranking!.ranked.length).toBeGreaterThan(0);

    const stored = await harness.store.getSites("inc-1");
    expect(stored).toHaveLength(3);
    expect(stored.every((site) => site.rankingVersion === 1)).toBe(true);
  });

  it("puts the care home first: it runs out of time before the school", async () => {
    const result = await service.rankIncident(incident(), bands, simulation);
    expect(result.ranking!.ranked[0]!.name).toBe("Residència Els Companys");
  });

  it("recommends an exclusion zone at the fuel station rather than an evacuation", async () => {
    const result = await service.rankIncident(incident(), bands, simulation);
    const fuel = result.ranking!.ranked.find((site) => site.id === "fuel-1");
    expect(fuel?.action).toBe("EXCLUSION_ZONE");
    expect(fuel?.explanation.actionReason).toContain("not an evacuation instruction");
  });

  it("increments the ranking version and records a diff on the second pass", async () => {
    await service.rankIncident(incident(), bands, simulation);
    const second = await service.rankIncident(incident(), bands, simulation);
    expect(second.version).toBe(2);
    const stored = await harness.store.getSites("inc-1");
    expect(stored.every((site) => site.rankingVersion === 2)).toBe(true);
  });

  it("opens the incident with bands only when exposure is unavailable", async () => {
    harness.talaia.exposure.mockRejectedValueOnce(new Error("Talaia unreachable"));
    const result = await service.rankIncident(incident(), bands, simulation);
    expect(result.ranking).toBeNull();
    expect(result.degraded).toContain("Talaia unreachable");
    expect(harness.events.some((event) => event.kind === "exposure_degraded")).toBe(true);
  });

  it("reports a degraded exposure mode on the timeline", async () => {
    harness.talaia.exposure.mockResolvedValueOnce({
      ...exposureReport(),
      degraded: { mode: "summary_only", reason: "Asset detail unavailable upstream." },
    });
    await service.rankIncident(incident(), bands, simulation);
    const event = harness.events.find((e) => e.kind === "exposure_degraded");
    expect(event?.message).toContain("summary only");
  });
});

describe("phone reports change the ranking", () => {
  it("re-ranks on reported occupancy and keeps the report across passes", async () => {
    const harness = makeContext();
    const service = new ExposureService(harness.ctx);
    const simulation = ensembleSimulation();
    const bands = bandsFromSimulation(simulation, { horizonHours: 6 });

    const incidents = new IncidentService(harness.ctx);
    // Extraction needs no model: feed the structured report directly, which is
    // the same path a pasted transcript takes once it has been parsed.
    vi.spyOn(incidents.extraction, "extract").mockResolvedValue({
      report: {
        peoplePresent: 280,
        nonAmbulatory: 40,
        vehicles: ["one bus"],
        needsHelp: true,
        willFollowAction: true,
        alreadyEvacuated: false,
        livestockPresent: null,
        corrections: ["Said 300 then corrected to 280."],
        notes: "Needs transport for 40 pupils who cannot walk far.",
        confidence: 0.9,
        capturedAt: new Date().toISOString(),
        source: "phone",
      },
      model: "test",
      latencyMs: 10,
      error: null,
    });

    await harness.store.upsertIncident(incident());
    // A re-rank reuses the stored model run rather than asking for a new one,
    // so the run has to exist for the phone report to move anything.
    await harness.store.saveSpreadRun({
      id: "run-1", incidentId: "inc-1", simulationId: "sim-test", status: "COMPLETED",
      result: simulation, bands, requestedAt: new Date().toISOString(),
    });
    const before = await service.rankIncident(incident(), bands, simulation);
    const schoolBefore = before.ranking!.ranked.find((site) => site.id === "school-1")!;
    expect(schoolBefore.evac.basis).toBe("registered");

    const outcome = await incidents.applyTranscript({
      incidentId: "inc-1",
      assetId: "school-1",
      transcript: "Somos doscientos ochenta ahora mismo. Cuarenta no pueden andar.",
    });
    expect(outcome.reranked).toBe(true);
    expect(outcome.summary).toContain("280 people present");

    const stored = await harness.store.getSite("inc-1", "school-1");
    expect(stored!.reported?.peoplePresent).toBe(280);
    expect(stored!.payload.evac.basis).toBe("reported");
    // Reported occupancy plus forty non-ambulatory pupils is a far longer
    // evacuation than the registered figure implied.
    expect(stored!.payload.evac.minutes).toBeGreaterThan(schoolBefore.evac.minutes);

    // The crucial property: a later ranking pass must not forget the call.
    await service.rankIncident(incident(), bands, simulation);
    const afterRerank = await harness.store.getSite("inc-1", "school-1");
    expect(afterRerank!.reported?.peoplePresent).toBe(280);
    expect(afterRerank!.payload.evac.basis).toBe("reported");
  });

  it("changes nothing when the transcript cannot be read", async () => {
    const harness = makeContext();
    const service = new ExposureService(harness.ctx);
    const simulation = ensembleSimulation();
    const bands = bandsFromSimulation(simulation, { horizonHours: 6 });
    const incidents = new IncidentService(harness.ctx);

    vi.spyOn(incidents.extraction, "extract").mockResolvedValue({
      report: null, model: null, latencyMs: null, error: "NEBIUS_API_KEY is not set.",
    });

    await harness.store.upsertIncident(incident());
    await service.rankIncident(incident(), bands, simulation);

    const outcome = await incidents.applyTranscript({
      incidentId: "inc-1",
      assetId: "school-1",
      transcript: "...",
    });
    expect(outcome.reranked).toBe(false);
    expect(outcome.summary).toContain("ranking is unchanged");

    const stored = await harness.store.getSite("inc-1", "school-1");
    expect(stored!.reported).toBeNull();
  });
});

describe("coordinator status overrides", () => {
  it("keeps an evacuated site marked across a re-rank", async () => {
    const harness = makeContext();
    const service = new ExposureService(harness.ctx);
    const simulation = ensembleSimulation();
    const bands = bandsFromSimulation(simulation, { horizonHours: 6 });
    const incidents = new IncidentService(harness.ctx);

    await harness.store.upsertIncident(incident());
    await harness.store.saveSpreadRun({
      id: "run-1", incidentId: "inc-1", simulationId: "sim-test", status: "COMPLETED",
      result: simulation, bands, requestedAt: new Date().toISOString(),
    });
    await service.rankIncident(incident(), bands, simulation);

    await incidents.setSiteStatus({
      incidentId: "inc-1",
      assetId: "care-1",
      status: "evacuated",
      actor: "coordinator",
      via: "web",
    });

    const stored = await harness.store.getSite("inc-1", "care-1");
    expect(stored!.status).toBe("evacuated");

    await service.rankIncident(incident(), bands, simulation);
    const after = await harness.store.getSite("inc-1", "care-1");
    expect(after!.status).toBe("evacuated");
    expect(after!.payload.action).toBe("MONITOR");
  });
});

describe("honesty about what happened", () => {
  it("says the order is unchanged when there is no model run to re-rank against", async () => {
    const harness = makeContext();
    const service = new ExposureService(harness.ctx);
    const simulation = ensembleSimulation();
    const bands = bandsFromSimulation(simulation, { horizonHours: 6 });
    const incidents = new IncidentService(harness.ctx);

    vi.spyOn(incidents.extraction, "extract").mockResolvedValue({
      report: {
        peoplePresent: 12, nonAmbulatory: null, vehicles: [], needsHelp: null,
        willFollowAction: null, alreadyEvacuated: null, livestockPresent: null,
        corrections: [], notes: null, confidence: 0.8,
        capturedAt: new Date().toISOString(), source: "phone",
      },
      model: "test", latencyMs: 5, error: null,
    });

    await harness.store.upsertIncident(incident());
    await service.rankIncident(incident(), bands, simulation);
    // Deliberately no spread run saved.

    const outcome = await incidents.applyTranscript({
      incidentId: "inc-1", assetId: "care-1", transcript: "Somos doce.",
    });

    expect(outcome.reranked).toBe(false);
    expect(outcome.summary).toContain("order is unchanged");
    // The report itself is still kept: nothing a site said is thrown away.
    const stored = await harness.store.getSite("inc-1", "care-1");
    expect(stored!.reported?.peoplePresent).toBe(12);
  });
});
