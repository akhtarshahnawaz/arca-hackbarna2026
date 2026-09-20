import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memory-store.js";
import { maskPhone } from "../src/store.js";
import type { Incident, RankedSite, SiteReport } from "@arca/core";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    clusterId: "cluster-1",
    name: "Calonge",
    status: "confirmed",
    replay: false,
    position: [3.03, 41.89],
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

function siteRecord(assetId: string, rank: number) {
  return {
    id: `inc-1:${assetId}`,
    incidentId: "inc-1",
    assetId,
    rankingVersion: 1,
    payload: { id: assetId, name: assetId } as unknown as RankedSite,
    status: "unnotified" as const,
    reported: null,
    rank,
    action: "EVACUATE_NOW",
    spareMinutes: -40,
    updatedAt: new Date().toISOString(),
  };
}

const report: SiteReport = {
  peoplePresent: 38, nonAmbulatory: 12, vehicles: ["9-seat van"],
  needsHelp: true, willFollowAction: true, alreadyEvacuated: false, livestockPresent: null,
  corrections: [], notes: "Needs ambulances.", confidence: 0.9,
  capturedAt: "2026-09-19T13:10:00.000Z", source: "phone",
};

describe("MemoryStore", () => {
  it("upserts an incident by cluster without forking a duplicate", async () => {
    const store = new MemoryStore();
    await store.upsertIncident(incident());
    await store.upsertIncident(incident({ name: "Calonge i Sant Antoni" }));
    const all = await store.listIncidents();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Calonge i Sant Antoni");
    expect(await store.getIncidentByCluster("cluster-1")).not.toBeNull();
  });

  it("preserves coordinator work across a re-rank", async () => {
    const store = new MemoryStore();
    await store.upsertIncident(incident());
    await store.saveSites("inc-1", [siteRecord("care", 1), siteRecord("school", 2)]);

    await store.updateSiteStatus("inc-1", "care", "approved");
    await store.setSiteReport("inc-1", "care", report);

    // A later ranking pass writes fresh rows with default status and no report.
    await store.saveSites("inc-1", [siteRecord("school", 1), siteRecord("care", 2)]);

    const care = await store.getSite("inc-1", "care");
    expect(care!.status).toBe("reported");
    expect(care!.reported?.peoplePresent).toBe(38);
    expect(care!.rank).toBe(2);
  });

  it("prefers a completed spread run over a newer failure", async () => {
    const store = new MemoryStore();
    await store.saveSpreadRun({
      id: "run-1", incidentId: "inc-1", simulationId: "sim-1", status: "COMPLETED",
      requestedAt: "2026-09-19T12:00:00.000Z",
    });
    await store.saveSpreadRun({
      id: "run-2", incidentId: "inc-1", simulationId: "sim-2", status: "FAILED",
      requestedAt: "2026-09-19T12:30:00.000Z",
    });
    const latest = await store.latestSpreadRun("inc-1");
    expect(latest!.id).toBe("run-1");
  });

  it("keeps the timeline in order and bounded", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 5; i++) {
      await store.addTimelineEvent({
        id: `e${i}`, incidentId: "inc-1", at: new Date(Date.now() + i * 1000).toISOString(),
        kind: "note", actor: "system", message: `event ${i}`,
      });
    }
    const recent = await store.getTimeline("inc-1", 3);
    expect(recent).toHaveLength(3);
    expect(recent[2]!.message).toBe("event 4");
  });

  it("tracks open calls separately from finished ones", async () => {
    const store = new MemoryStore();
    const base = {
      incidentId: "inc-1", siteId: "care", provider: "slng", providerCallId: null,
      phoneMasked: "+349••••122", mode: "phone" as const,
      dispatchedAt: new Date().toISOString(),
    };
    await store.saveCall({ ...base, id: "c1", status: "dispatched" });
    await store.saveCall({ ...base, id: "c2", status: "completed" });
    expect(await store.listOpenCalls()).toHaveLength(1);
    await store.updateCall("c1", { status: "completed", transcript: "hola" });
    expect(await store.listOpenCalls()).toHaveLength(0);
    expect((await store.getCall("c1"))!.transcript).toBe("hola");
  });

  it("removes everything belonging to a deleted incident", async () => {
    const store = new MemoryStore();
    await store.upsertIncident(incident());
    await store.saveSites("inc-1", [siteRecord("care", 1)]);
    await store.addTimelineEvent({
      id: "e", incidentId: "inc-1", at: new Date().toISOString(),
      kind: "note", actor: "system", message: "x",
    });
    await store.deleteIncident("inc-1");
    expect(await store.getIncident("inc-1")).toBeNull();
    expect(await store.getSites("inc-1")).toHaveLength(0);
    expect(await store.getTimeline("inc-1")).toHaveLength(0);
  });

  it("round-trips key-value state used for watermarks and tokens", async () => {
    const store = new MemoryStore();
    await store.setKv("watermark", { lastObserved: "2026-09-19T13:00:00.000Z" });
    expect(await store.getKv<{ lastObserved: string }>("watermark")).toEqual({
      lastObserved: "2026-09-19T13:00:00.000Z",
    });
    expect(await store.getKv("missing")).toBeNull();
  });
});

describe("phone masking", () => {
  it("shows enough to recognise a number and not enough to dial it", () => {
    expect(maskPhone("+34938741122")).toBe("+349•••••122");
    expect(maskPhone("+34938741122")).not.toContain("8741");
    expect(maskPhone("123")).toBe("•••");
  });
});
