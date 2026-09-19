import evacConfig from "../config/evac-times.json";
import { median, pointInRing } from "./geo";
import type {
  EvacConfig,
  HourPolygon,
  RankedPartition,
  ReachLabel,
  RankedSite,
  SiteInput,
} from "./types";

/** Main ranking includes likely (≥0.7) and possible (0.3–0.7). Below 0.3 is watch only. */
export const MAIN_MIN_P_REACH = 0.3;

const config = evacConfig as EvacConfig;

export function reachLabel(pReach: number): ReachLabel {
  if (pReach >= 0.7) return "likely";
  if (pReach >= 0.3) return "possible";
  return "watch";
}

export function animalLoad(site: SiteInput): number {
  return site.animals.reduce((sum, animal) => {
    const count = animal.confirmedCount ?? animal.registeredCapacity ?? 0;
    return sum + count;
  }, 0);
}

export function evacHoursForSite(site: SiteInput, cfg: EvacConfig = config): number {
  if (site.kind === "household") {
    return site.hasOwnTransport
      ? cfg.byTypeHours.household_with_car
      : cfg.byTypeHours.household_no_car;
  }

  if (site.kind !== "farm") {
    return cfg.byTypeHours[site.kind] ?? 1;
  }

  let hours = cfg.farm.baseHours;
  for (const animal of site.animals) {
    const count = animal.confirmedCount ?? animal.registeredCapacity ?? 0;
    const species = animal.species.toLowerCase();
    if (species.includes("sheep") || species.includes("oví") || species.includes("ovi")) {
      hours += (count / 100) * cfg.farm.per100SheepHours;
    } else if (species.includes("goat") || species.includes("cabra")) {
      hours += (count / 100) * cfg.farm.per100GoatsHours;
    } else if (species.includes("pig") || species.includes("porc")) {
      hours += cfg.farm.pigsHours;
    } else if (species.includes("horse") || species.includes("equí") || species.includes("equi")) {
      hours += cfg.farm.horsesHours;
    } else {
      hours += (count / 100) * cfg.farm.per100GoatsHours;
    }
  }

  return Math.round(hours * 100) / 100;
}

export function arrivalHoursForSite(
  site: SiteInput,
  polygons: HourPolygon[],
  ensembleMembers: number,
  horizonHours: number,
): number[] {
  const arrivals: number[] = [];

  for (let member = 0; member < ensembleMembers; member += 1) {
    const memberPolys = polygons
      .filter((polygon) => polygon.member === member && polygon.hour <= horizonHours)
      .sort((a, b) => a.hour - b.hour);

    const first = memberPolys.find((polygon) =>
      pointInRing([site.lon, site.lat], polygon.ring),
    );

    if (first) arrivals.push(first.hour);
  }

  return arrivals;
}

export function rankSites(
  sites: SiteInput[],
  polygons: HourPolygon[],
  options?: { ensembleMembers?: number; horizonHours?: number },
): RankedPartition {
  const ensembleMembers = options?.ensembleMembers ?? config.ensembleMembers;
  const horizonHours = options?.horizonHours ?? config.horizonHours;

  const scored = sites.map((site) => {
    const arrivalHours = arrivalHoursForSite(site, polygons, ensembleMembers, horizonHours);
    const pReach = arrivalHours.length / ensembleMembers;
    const tArrival = median(arrivalHours);
    const tEvac = evacHoursForSite(site);
    const spareTime =
      tArrival === null ? null : Math.round((tArrival - tEvac) * 100) / 100;

    return {
      ...site,
      rank: 0,
      pReach,
      runsReach: arrivalHours.length,
      ensembleMembers,
      tArrival,
      tEvac,
      spareTime,
      label: reachLabel(pReach),
      arrivalHours,
    } satisfies RankedSite;
  });

  const main = scored.filter((site) => site.pReach >= MAIN_MIN_P_REACH);
  const watch = scored.filter((site) => site.pReach < MAIN_MIN_P_REACH);

  main.sort(compareBySpareThenReach);
  watch.sort(compareBySpareThenReach);

  return {
    ranked: main.map((site, index) => ({ ...site, rank: index + 1 })),
    watch: watch.map((site) => ({ ...site, rank: 0 })),
  };
}

export function compareBySpareThenReach(a: RankedSite, b: RankedSite): number {
  const aSpare = a.spareTime ?? Number.POSITIVE_INFINITY;
  const bSpare = b.spareTime ?? Number.POSITIVE_INFINITY;
  if (aSpare !== bSpare) return aSpare - bSpare;
  if (a.pReach !== b.pReach) return b.pReach - a.pReach;
  return a.code.localeCompare(b.code);
}

export function ensembleReachCopy(
  runsReach: number,
  ensembleMembers: number,
  hours: number | null,
): string {
  if (runsReach === 0 || hours === null) {
    return `In 0 of ${ensembleMembers} runs, fire reaches within the ${config.horizonHours} h horizon`;
  }
  return `In ${runsReach} of ${ensembleMembers} runs, fire reaches within ${hours} h`;
}

export function spareTimeCopy(spareTime: number | null): string {
  if (spareTime === null) {
    return "No ensemble run reaches this site inside the horizon. Keep it on watch.";
  }
  if (spareTime < 0) {
    const behind = Math.abs(spareTime);
    return `Already behind by ${formatHours(behind)}. Evacuation time is longer than the ensemble arrival window. Start now and send extra transport.`;
  }
  if (spareTime === 0) {
    return "Spare time is zero. Movement has to start now to finish as the fire arrives in the median reaching run.";
  }
  return `${formatHours(spareTime)} of spare time in the median reaching run. Still a clock, not a guarantee.`;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  const sign = rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded)} h`;
}
