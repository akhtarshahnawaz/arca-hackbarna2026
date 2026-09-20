import { rankingPolicy } from "../config/index.js";
import { reachStats } from "../spread/bands.js";
import type { Position } from "../geo/index.js";
import type {
  ExposureAsset,
  ExposureReport,
  RankedSite,
  RankingResult,
  ReachStats,
  Simulation,
  SiteReport,
  SiteStatus,
} from "../domain/types.js";
import { decideAction } from "./actions.js";
import { estimateEvacMinutes, livestockUnitsOf } from "./evac.js";

export interface RankOptions {
  simulation?: Simulation | null;
  horizonHours?: number;
  ensembleMembers?: number;
  /** Phone reports and coordinator overrides, keyed by Talaia asset id. */
  reports?: Map<string, SiteReport>;
  statuses?: Map<string, SiteStatus>;
  version?: number;
  now?: Date;
}

function assetPosition(asset: ExposureAsset): Position | null {
  const geometry = asset.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates as [number, number];
    return [lon, lat];
  }
  const points: Position[] = [];
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push([coords[0] as number, coords[1] as number]);
      return;
    }
    for (const child of coords) visit(child);
  };
  visit((geometry as { coordinates?: unknown }).coordinates);
  if (points.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / points.length, lat / points.length];
}

/**
 * Reach statistics for an asset.
 *
 * The simulation is the authority when one exists. When it does not — a failed
 * or queued run — Talaia's own band assignment is the fallback, since it already
 * placed the asset in the earliest band that reaches it. That fallback is marked
 * `singleRun`, because a band with no model behind it cannot claim an ensemble.
 */
function reachForAsset(
  asset: ExposureAsset,
  position: Position | null,
  options: RankOptions,
): ReachStats {
  if (options.simulation?.result && position) {
    return reachStats(position, options.simulation, {
      horizonHours: options.horizonHours ?? rankingPolicy.horizonHours,
      ensembleMembers: options.ensembleMembers ?? rankingPolicy.ensembleMembers,
    });
  }

  const bandMinutes = asset.exposure?.band_minutes ?? null;
  const inside = asset.exposure?.inside_aoi ?? bandMinutes !== null;
  return {
    pReach: inside ? 1 : 0,
    arrivalMinutesP20: bandMinutes,
    arrivalMinutesP50: bandMinutes,
    runsReaching: inside ? 1 : 0,
    runsTotal: 1,
    singleRun: true,
  };
}

function livestockSpeciesOf(asset: ExposureAsset): Array<{ species: string; count: number }> {
  const capacity = asset.capacity as Record<string, unknown> | null;
  const raw = capacity?.["species"];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const species = typeof record.species === "string" ? record.species : null;
      const count = typeof record.count === "number" ? record.count : null;
      return species && count !== null ? { species, count } : null;
    })
    .filter((x): x is { species: string; count: number } => x !== null);
}

/**
 * Rank every exposed asset by spare time.
 *
 * `spare = arrival − evacuation need`. Sorting by it puts the site that runs out
 * of time first at the top, which is a different list from "biggest" or "most
 * valuable" and is the only one that answers who to call first. Talaia's
 * life-safety priority score breaks ties; it never leads, because a large
 * school with four hours of warning is not more urgent than a small care home
 * with twenty minutes.
 */
export function rankSites(
  exposure: ExposureReport,
  options: RankOptions = {},
): RankingResult {
  const now = options.now ?? new Date();
  const reports = options.reports ?? new Map<string, SiteReport>();
  const statuses = options.statuses ?? new Map<string, SiteStatus>();
  const horizon = options.horizonHours ?? rankingPolicy.horizonHours;

  const sites: RankedSite[] = [];

  for (const asset of exposure.assets ?? []) {
    const position = assetPosition(asset);
    const reach = reachForAsset(asset, position, options);
    const reported = reports.get(asset.id) ?? null;
    const status = statuses.get(asset.id) ?? "unnotified";

    const livestockUnits = livestockUnitsOf(asset);
    const evac = estimateEvacMinutes({
      subcategory: asset.subcategory,
      category: asset.category,
      capacityPeople: asset.capacity?.people ?? asset.capacity?.places ?? null,
      capacityBasis: asset.capacity?.basis ?? null,
      livestockUnits,
      livestockSpecies: livestockSpeciesOf(asset),
      reported,
    });

    const arrivalMinutes = reach.arrivalMinutesP20 ?? asset.exposure?.band_minutes ?? null;
    const spareMinutes = arrivalMinutes === null ? null : arrivalMinutes - evac.minutes;

    // A site already emptied is not a ranking problem any more. It stays in the
    // list with its status so the coordinator can see the work that is done.
    const settled = status === "evacuated" || status === "do_not_call";

    const decision = settled
      ? {
          action: "MONITOR" as const,
          reason:
            status === "evacuated"
              ? "Reported clear. Kept on the list so the coordinator can see it is done."
              : "Marked do-not-call by the coordinator.",
        }
      : decideAction({
          reach,
          spareMinutes,
          arrivalMinutes,
          hazardous: Boolean(asset.hazardous),
          responseAsset: Boolean(asset.response_asset),
          humanBearing: Boolean(asset.human_bearing),
          livestockMinutes: evac.livestockMinutes,
        });

    const tier: RankedSite["tier"] =
      reach.pReach >= rankingPolicy.likelyAtProbability
        ? "likely"
        : reach.pReach >= rankingPolicy.watchBelowProbability
          ? "possible"
          : "watch";

    sites.push({
      id: asset.id,
      assetId: asset.id,
      name: asset.name,
      category: asset.category,
      subcategory: asset.subcategory,
      position,
      band: asset.exposure?.band ?? null,
      bandMinutes: asset.exposure?.band_minutes ?? null,
      distanceToFrontM: asset.exposure?.distance_to_front_m ?? null,
      priorityScore: asset.exposure?.priority_score ?? 0,
      reach,
      arrivalMinutes,
      evac,
      spareMinutes,
      action: decision.action,
      rank: 0,
      tier,
      status,
      humanBearing: Boolean(asset.human_bearing),
      hazardous: Boolean(asset.hazardous),
      responseAsset: Boolean(asset.response_asset),
      peopleEstimate: evac.people,
      livestockUnits,
      valueEur: asset.valuation?.total_eur ?? null,
      contacts: asset.contacts ?? null,
      capacity: asset.capacity ?? null,
      valuation: asset.valuation ?? null,
      provenance: asset.provenance ?? [],
      reported,
      occupancyNote: asset.occupancy_note ?? null,
      explanation: {
        runsReaching: reach.runsReaching,
        runsTotal: reach.runsTotal,
        arrivalMinutes,
        arrivalMinutesP50: reach.arrivalMinutesP50,
        evacMinutes: evac.minutes,
        peopleBasis: evac.basis,
        people: evac.people,
        assumptions: evac.assumptions,
        actionReason: decision.reason,
        singleRun: reach.singleRun,
      },
    });
  }

  const main = sites.filter((s) => s.tier !== "watch");
  const watch = sites.filter((s) => s.tier === "watch");

  main.sort(compareSites);
  watch.sort(compareSites);

  const ranked = main.map((site, index) => ({ ...site, rank: index + 1 }));

  return {
    version: options.version ?? 1,
    computedAt: now.toISOString(),
    ranked,
    watch,
    totals: {
      sites: sites.length,
      peopleAtFacilities: exposure.summary?.people_estimate ?? sumBy(sites, (s) => s.peopleEstimate),
      populationResident: exposure.summary?.population_resident ?? 0,
      livestockUnits: exposure.summary?.livestock_units ?? sumBy(sites, (s) => s.livestockUnits ?? 0),
      valueEur: exposure.summary?.total_value_eur ?? sumBy(sites, (s) => s.valueEur ?? 0),
      evacuateNow: ranked.filter((s) => s.action === "EVACUATE_NOW").length,
      shelterCandidates: ranked.filter((s) => s.action === "SHELTER_CANDIDATE").length,
      hazardous: sites.filter((s) => s.hazardous).length,
    },
  };
}

/**
 * Spare time, at the precision it is actually known to.
 *
 * Spare time comes from an ensemble arrival estimate minus a parametric
 * evacuation model. Neither is accurate to the minute, and the error grows with
 * the magnitude: "twelve minutes short" is a real distinction, "twelve minutes
 * apart at thirteen hours short" is noise in both models.
 *
 * Sorting on the raw minute treats the two identically, and at scale that has a
 * specific, bad consequence. A live Talaia query over a large footprint returns
 * thousands of assets, most of them field parcels with a class-default headcount
 * of two. Sorted strictly by minute, an unnamed sheep shed that is 13.1 hours
 * short outranks a care home that is 12.9 hours short. Both lose the race. Only
 * one of them is who you call first.
 *
 * So spare time is compared on a signed log scale: roughly five-minute
 * resolution near the decision point, widening to hours out in the region where
 * nothing is going to arrive in time anyway. Monotonic, so a genuinely shorter
 * clock still sorts first.
 */
function spareRank(spareMinutes: number | null): number {
  if (spareMinutes === null) return Number.POSITIVE_INFINITY;
  const sign = Math.sign(spareMinutes);
  return Math.round(sign * Math.log1p(Math.abs(spareMinutes) / 15) * 4);
}

/**
 * Least spare time first; a site with no clock at all sorts last.
 *
 * Where two sites are indistinguishable on the clock, the order is how many
 * runs agree, then Talaia's life-safety score, then id — the last one only so
 * the order is stable across recomputations and the UI does not shuffle rows
 * that did not actually move.
 */
export function compareSites(a: RankedSite, b: RankedSite): number {
  const aSpare = spareRank(a.spareMinutes);
  const bSpare = spareRank(b.spareMinutes);
  if (aSpare !== bSpare) return aSpare - bSpare;
  if (a.reach.pReach !== b.reach.pReach) return b.reach.pReach - a.reach.pReach;
  if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
  return a.id.localeCompare(b.id);
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + (pick(item) || 0), 0);
}

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(minutes);
  if (abs < 90) return `${sign}${Math.round(abs)} min`;
  const hours = abs / 60;
  return `${sign}${hours.toFixed(1)} h`;
}

/** The sentence the agent and the UI both use, so they never disagree. */
export function reachCopy(site: RankedSite): string {
  const { runsReaching, runsTotal } = site.reach;
  if (site.reach.singleRun) {
    return site.arrivalMinutes === null
      ? "Single model run; no arrival time inside the horizon."
      : `Single model run: fire reaches this site in about ${formatMinutes(site.arrivalMinutes)}.`;
  }
  if (runsReaching === 0 || site.arrivalMinutes === null) {
    return `In 0 of ${runsTotal} runs does the fire reach this site inside the horizon.`;
  }
  return `In ${runsReaching} of ${runsTotal} runs the fire reaches this site within ${formatMinutes(
    site.arrivalMinutes,
  )}.`;
}

export function spareCopy(site: RankedSite): string {
  if (site.spareMinutes === null) {
    return "No arrival time inside the horizon. Keep on watch.";
  }
  if (site.spareMinutes < 0) {
    return `Behind by ${formatMinutes(
      Math.abs(site.spareMinutes),
    )}: the fire is expected before the site can be emptied. Urgency, not an order — the coordinator decides with Bombers.`;
  }
  return `${formatMinutes(site.spareMinutes)} of spare time against a ${formatMinutes(
    site.evac.minutes,
  )} evacuation.`;
}
