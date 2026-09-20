import { describe, expect, it } from "vitest";
import { compareSites, rankSites, formatMinutes, reachCopy, spareCopy } from "../src/ranking/rank.js";
import { estimateEvacMinutes, resolvePeople } from "../src/ranking/evac.js";
import { decideAction } from "../src/ranking/actions.js";
import { rankingDiff } from "../src/ranking/diff.js";
import type { SiteReport } from "../src/domain/types.js";
import { asset, ensembleSimulation, exposure } from "./fixtures.js";

const report = (overrides: Partial<SiteReport> = {}): SiteReport => ({
  peoplePresent: null,
  nonAmbulatory: null,
  vehicles: [],
  needsHelp: null,
  willFollowAction: null,
  alreadyEvacuated: null,
  livestockPresent: null,
  corrections: [],
  notes: null,
  confidence: 0.9,
  capturedAt: "2026-09-19T12:30:00Z",
  source: "phone",
  ...overrides,
});

describe("people resolution", () => {
  it("prefers a reported count over registered capacity", () => {
    const result = resolvePeople({
      subcategory: "care_home",
      category: "social_care",
      capacityPeople: 64,
      reported: report({ peoplePresent: 38 }),
    });
    expect(result).toEqual({ people: 38, basis: "reported" });
  });

  it("distinguishes a reported zero from no answer", () => {
    expect(
      resolvePeople({
        subcategory: "school",
        category: "education",
        capacityPeople: 300,
        reported: report({ peoplePresent: 0 }),
      }),
    ).toEqual({ people: 0, basis: "reported" });

    expect(
      resolvePeople({
        subcategory: "school",
        category: "education",
        capacityPeople: 300,
        reported: report({ peoplePresent: null }),
      }),
    ).toEqual({ people: 300, basis: "registered" });
  });
});

describe("evacuation time", () => {
  it("scales a care home with its occupancy", () => {
    const small = estimateEvacMinutes({ subcategory: "care_home", category: "social_care", capacityPeople: 10 });
    const large = estimateEvacMinutes({ subcategory: "care_home", category: "social_care", capacityPeople: 100 });
    expect(large.minutes).toBeGreaterThan(small.minutes);
    expect(small.basis).toBe("registered");
  });

  it("adds time for people who cannot walk unaided", () => {
    const base = estimateEvacMinutes({
      subcategory: "care_home", category: "social_care", capacityPeople: 64,
      reported: report({ peoplePresent: 38 }),
    });
    const withChairs = estimateEvacMinutes({
      subcategory: "care_home", category: "social_care", capacityPeople: 64,
      reported: report({ peoplePresent: 38, nonAmbulatory: 12 }),
    });
    expect(withChairs.minutes).toBe(base.minutes + 48);
    expect(withChairs.assumptions.join(" ")).toContain("unable to walk unaided");
  });

  it("charges livestock by species, because a pig is not a sheep", () => {
    const sheep = estimateEvacMinutes({
      subcategory: "livestock_farm", category: "livestock",
      livestockSpecies: [{ species: "sheep", count: 300 }],
    });
    const pigs = estimateEvacMinutes({
      subcategory: "livestock_farm", category: "livestock",
      livestockSpecies: [{ species: "pig", count: 300 }],
    });
    expect(pigs.livestockMinutes).toBeGreaterThan(sheep.livestockMinutes);
    expect(sheep.assumptions.join(" ")).toContain("300 sheep");
  });

  it("keeps animal time out of the people clearance time", () => {
    // Two staff who can walk out in minutes, and a herd that cannot be moved
    // for hours. Adding those together says the staff cannot escape, which is
    // both false and — on live registry data — enough to fill the top of a
    // ranked list with unnamed field parcels.
    const farm = estimateEvacMinutes({
      subcategory: "livestock_farm", category: "livestock",
      capacityPeople: 2,
      livestockSpecies: [{ species: "sheep", count: 6_000 }],
    });

    expect(farm.livestockMinutes).toBeGreaterThan(300);
    expect(farm.minutes).toBeLessThan(120);
  });

  it("caps an impossible livestock evacuation and says why", () => {
    const huge = estimateEvacMinutes({
      subcategory: "livestock_farm", category: "livestock",
      livestockSpecies: [{ species: "pig", count: 100_000 }],
    });
    expect(huge.livestockMinutes).toBeLessThanOrEqual(1440);
  });

  it("always states its assumptions", () => {
    const estimate = estimateEvacMinutes({ subcategory: "care_home", category: "social_care", capacityPeople: 64 });
    expect(estimate.assumptions.length).toBeGreaterThan(0);
    expect(estimate.assumptions.join(" ")).toContain("fixed overhead");
  });
});

describe("protective action", () => {
  const reach = { pReach: 0.9, arrivalMinutesP20: 120, arrivalMinutesP50: 180, runsReaching: 9, runsTotal: 10, singleRun: false };

  it("recommends shelter when the clock has already run out", () => {
    const decision = decideAction({
      reach, spareMinutes: -46, arrivalMinutes: 120,
      hazardous: false, responseAsset: false, humanBearing: true,
    });
    expect(decision.action).toBe("SHELTER_CANDIDATE");
    expect(decision.reason).toContain("Coordinator decides");
  });

  it("recommends evacuating when there is time but not much", () => {
    const decision = decideAction({
      reach, spareMinutes: 60, arrivalMinutes: 180,
      hazardous: false, responseAsset: false, humanBearing: true,
    });
    expect(decision.action).toBe("EVACUATE_NOW");
  });

  it("puts a hazardous site in an exclusion zone, not an evacuation", () => {
    const decision = decideAction({
      reach, spareMinutes: -20, arrivalMinutes: 40,
      hazardous: true, responseAsset: false, humanBearing: false,
    });
    expect(decision.action).toBe("EXCLUSION_ZONE");
    expect(decision.reason).toContain("not an evacuation instruction");
  });

  it("keeps a barely-threatened site off the main list", () => {
    const decision = decideAction({
      reach: { ...reach, pReach: 0.1, runsReaching: 1 },
      spareMinutes: 300, arrivalMinutes: 360,
      hazardous: false, responseAsset: false, humanBearing: true,
    });
    expect(decision.action).toBe("MONITOR");
  });

  it("flags a hospital with time as a resource at risk", () => {
    const decision = decideAction({
      reach, spareMinutes: 300, arrivalMinutes: 360,
      hazardous: false, responseAsset: true, humanBearing: true,
    });
    expect(decision.action).toBe("RESOURCE_AT_RISK");
  });
});

describe("ranking", () => {
  const simulation = ensembleSimulation();

  const careHome = asset({
    id: "care", name: "Residència Els Companys", subcategory: "care_home",
    category: "social_care", geometry: { type: "Point", coordinates: [1.8, 41.7] },
    capacity: { places: 64, people: 64, basis: "RESES", confidence: 0.7 },
  });
  const school = asset({
    id: "school", name: "Escola Pia", subcategory: "primary_school",
    category: "education", geometry: { type: "Point", coordinates: [1.803, 41.702] },
    capacity: { places: 300, people: 300, basis: "enrolment", confidence: 0.8 },
    criticality: 95,
  });
  const faraway = asset({
    id: "far", name: "Hospital de Sant Joan", subcategory: "hospital",
    category: "healthcare", geometry: { type: "Point", coordinates: [2.6, 41.7] },
    capacity: { places: 400, people: 400, basis: "beds", confidence: 0.9 },
    response_asset: true,
  });

  it("ranks by spare time, not by size", () => {
    const result = rankSites(exposure([school, careHome]), { simulation, ensembleMembers: 10 });
    // The school holds five times the people, but the care home needs far
    // longer to move them, so it runs out of time first.
    expect(result.ranked[0]!.id).toBe("care");
    expect(result.ranked[0]!.spareMinutes!).toBeLessThan(result.ranked[1]!.spareMinutes!);
  });

  it("moves a site off the main list when no run reaches it", () => {
    const result = rankSites(exposure([careHome, faraway]), { simulation, ensembleMembers: 10 });
    expect(result.ranked.map((s) => s.id)).not.toContain("far");
    expect(result.watch.map((s) => s.id)).toContain("far");
  });

  it("re-ranks on a phone report and explains the move", () => {
    const before = rankSites(exposure([school, careHome]), {
      simulation, ensembleMembers: 10, version: 1,
    });

    const reports = new Map([["school", report({ peoplePresent: 280, nonAmbulatory: 40 })]]);
    const after = rankSites(exposure([school, careHome]), {
      simulation, ensembleMembers: 10, version: 2, reports,
    });

    const schoolAfter = after.ranked.find((s) => s.id === "school")!;
    expect(schoolAfter.evac.basis).toBe("reported");
    expect(schoolAfter.evac.minutes).toBeGreaterThan(
      before.ranked.find((s) => s.id === "school")!.evac.minutes,
    );

    const diff = rankingDiff(before, after);
    expect(diff.entries.length).toBeGreaterThan(0);
    expect(diff.summary).not.toBe("Ranking unchanged.");
    // The move that matters is the school overtaking the care home for first
    // place, and the reason must name the reported figures that caused it.
    const entry = diff.entries.find((e) => e.siteId === "school")!;
    expect(entry.toRank).toBe(1);
    expect(entry.reason).toContain("reported 280");
    expect(entry.reason).toContain("40 unable to walk unaided");
  });

  it("keeps an evacuated site visible but no longer urgent", () => {
    const statuses = new Map([["care", "evacuated" as const]]);
    const result = rankSites(exposure([careHome, school]), {
      simulation, ensembleMembers: 10, statuses,
    });
    const care = [...result.ranked, ...result.watch].find((s) => s.id === "care")!;
    expect(care.status).toBe("evacuated");
    expect(care.action).toBe("MONITOR");
    expect(care.explanation.actionReason).toContain("Reported clear");
  });

  it("produces a stable order across identical runs", () => {
    const once = rankSites(exposure([school, careHome, faraway]), { simulation, ensembleMembers: 10 });
    const twice = rankSites(exposure([faraway, careHome, school]), { simulation, ensembleMembers: 10 });
    expect(once.ranked.map((s) => s.id)).toEqual(twice.ranked.map((s) => s.id));
  });

  it("totals what is at risk", () => {
    const result = rankSites(exposure([careHome, school]), { simulation, ensembleMembers: 10 });
    expect(result.totals.sites).toBe(2);
    expect(result.totals.peopleAtFacilities).toBe(364);
    expect(result.totals.valueEur).toBeGreaterThan(0);
  });

  it("falls back to Talaia's bands when there is no simulation", () => {
    const result = rankSites(exposure([careHome]), { simulation: null });
    const site = result.ranked[0]!;
    expect(site.reach.singleRun).toBe(true);
    expect(site.arrivalMinutes).toBe(60);
    expect(reachCopy(site)).toContain("Single model run");
  });

  it("reports an empty exposure without throwing", () => {
    const result = rankSites(exposure([]), { simulation });
    expect(result.ranked).toHaveLength(0);
    expect(result.totals.sites).toBe(0);
  });
});

describe("ordering under pressure", () => {
  const site = (overrides: { id: string; spare: number; priority: number; pReach?: number }) =>
    ({
      id: overrides.id,
      assetId: overrides.id,
      spareMinutes: overrides.spare,
      priorityScore: overrides.priority,
      reach: { pReach: overrides.pReach ?? 0.9, runsReaching: 9, runsTotal: 10, singleRun: false },
    }) as never;

  it("prefers the more critical site when the clock is effectively the same", () => {
    // Twelve minutes apart on an estimate built from an ensemble arrival time
    // and a parametric evacuation model is not a real difference. Sorting on
    // the raw minute put an unnamed sheep shed above a care home; both lose the
    // race, and only one of them is who you call first.
    const shed = site({ id: "shed", spare: -781, priority: 20 });
    const careHome = site({ id: "care", spare: -769, priority: 95 });

    expect([shed, careHome].sort(compareSites)[0]).toBe(careHome);
  });

  it("still puts a genuinely shorter clock first", () => {
    const urgent = site({ id: "urgent", spare: -400, priority: 10 });
    const critical = site({ id: "critical", spare: -60, priority: 99 });

    expect([critical, urgent].sort(compareSites)[0]).toBe(urgent);
  });

  it("sorts a site with no arrival time last", () => {
    const timed = site({ id: "timed", spare: 600, priority: 10 });
    const untimed = { ...site({ id: "untimed", spare: 0, priority: 99 }), spareMinutes: null } as never;

    expect([untimed, timed].sort(compareSites)[0]).toBe(timed);
  });

  it("keeps a genuinely shorter clock first at every scale", () => {
    // The transform must be monotonic, or a site with less time could sort
    // below one with more — the single thing this ordering exists to prevent.
    const values = [-2000, -900, -400, -120, -60, -30, -12, -3, 0, 3, 12, 60, 400, 2000];
    const sorted = values
      .map((spare, index) => site({ id: `s${index}`, spare, priority: 50 }))
      .sort(compareSites)
      .map((entry: { spareMinutes: number }) => entry.spareMinutes);

    expect(sorted).toEqual(values);
  });

  it("is stable, so rows that did not move do not shuffle", () => {
    const a = site({ id: "a", spare: -100, priority: 50 });
    const b = site({ id: "b", spare: -100, priority: 50 });

    expect([a, b].sort(compareSites).map((s: { id: string }) => s.id)).toEqual(["a", "b"]);
    expect([b, a].sort(compareSites).map((s: { id: string }) => s.id)).toEqual(["a", "b"]);
  });
});

describe("copy", () => {
  it("formats minutes for a person reading under pressure", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(180)).toBe("3.0 h");
    expect(formatMinutes(-46)).toBe("−46 min");
    expect(formatMinutes(null)).toBe("—");
  });

  it("uses ensemble language the agent and the UI both share", () => {
    const result = rankSites(exposure([asset({ id: "c" })]), {
      simulation: ensembleSimulation(), ensembleMembers: 10,
    });
    const site = result.ranked[0]!;
    expect(reachCopy(site)).toMatch(/In \d+ of 10 runs/);
    // This site has negative spare time, so the copy must say so plainly and
    // hand the decision back to a person rather than issuing an order.
    expect(spareCopy(site)).toContain("Behind by");
    expect(spareCopy(site)).toContain("coordinator decides");
  });
});

describe("ranking diff", () => {
  it("says nothing when nothing moved", () => {
    const base = exposure([asset({ id: "a" })]);
    const first = rankSites(base, { simulation: ensembleSimulation(), version: 1 });
    const second = rankSites(base, { simulation: ensembleSimulation(), version: 2 });
    const diff = rankingDiff(first, second);
    expect(diff.entries).toHaveLength(0);
    expect(diff.summary).toBe("Ranking unchanged.");
  });

  it("describes the first ranking without inventing changes", () => {
    const result = rankSites(exposure([asset({ id: "a" })]), { simulation: ensembleSimulation() });
    const diff = rankingDiff(null, result);
    expect(diff.fromVersion).toBe(0);
    expect(diff.entries).toHaveLength(0);
    expect(diff.summary).toContain("First ranking");
  });
});
