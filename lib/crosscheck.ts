import { haversineKm, pointInRing } from "./geo";
import type {
  CheckedHotspot,
  FeedDetection,
  FireFeedId,
  HeatSource,
  Hotspot,
  RankedSite,
} from "./types";

/**
 * Two feeds never put the same fire on the same pixel: different satellites,
 * different overpass times, different gridding. A match is a judgement call
 * about distance and age, not an identity test, so the numbers are tunable.
 */
function numberFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Two detections are the same fire within this distance. */
export const matchKm = () => numberFromEnv("CROSSCHECK_MATCH_KM", 3);
/** ...and within this many hours of each other. Null timestamps skip the test. */
export const matchHours = () => numberFromEnv("CROSSCHECK_MATCH_HOURS", 24);
/** A site is "near" a corroborated hotspot within this distance. */
export const siteRadiusKm = () => numberFromEnv("CROSSCHECK_SITE_KM", 12);

function hoursApart(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(left - right) / 3_600_000;
}

/** The static heat source a point sits on, by polygon first and centroid second. */
export function staticHeatAt(
  point: { lat: number; lon: number },
  heatSources: HeatSource[],
  toleranceKm = 1,
): HeatSource | null {
  for (const source of heatSources) {
    if (source.ring.length > 2 && pointInRing([point.lon, point.lat], source.ring)) {
      return source;
    }
  }
  return (
    heatSources.find((source) => haversineKm(point, source) <= toleranceKm) ?? null
  );
}

/**
 * Tags every Deepfire hotspot with the other feeds that saw fire at the same
 * place and time, and with the static heat source underneath it when there is
 * one. Nothing is dropped: a coordinator is shown the disagreement.
 */
export function checkHotspots(
  hotspots: Hotspot[],
  detections: FeedDetection[],
  heatSources: HeatSource[] = [],
): CheckedHotspot[] {
  const km = matchKm();
  const hours = matchHours();

  return hotspots.map((spot) => {
    const feeds = new Set<FireFeedId>(["deepfire"]);
    let nearest: number | null = null;

    for (const detection of detections) {
      if (detection.feed === "deepfire") continue;
      const distance = haversineKm(spot, detection);
      if (distance > km) continue;
      const apart = hoursApart(spot.observedAt, detection.observedAt);
      if (apart !== null && apart > hours) continue;
      feeds.add(detection.feed);
      if (nearest === null || distance < nearest) nearest = distance;
    }

    const heat = staticHeatAt(spot, heatSources);

    return {
      ...spot,
      confirmedBy: [...feeds],
      matchKm: nearest === null ? null : Math.round(nearest * 100) / 100,
      staticHeat: heat ? heat.label : null,
    };
  });
}

/** A hotspot counts as corroborated when a second feed saw it and it is not a chimney. */
export function isCorroborated(spot: CheckedHotspot): boolean {
  return spot.confirmedBy.length > 1 && spot.staticHeat === null;
}

/**
 * Hangs the nearest corroborated hotspot on each site. A site with two feeds
 * agreeing on a fire nearby is the one the coordinator should look at first,
 * whatever the demo ensemble says about arrival times.
 */
export function corroborateSites<T extends RankedSite>(
  sites: T[],
  hotspots: CheckedHotspot[],
): T[] {
  const radius = siteRadiusKm();
  const corroborated = hotspots.filter(isCorroborated);

  return sites.map((site) => {
    let best: { spot: CheckedHotspot; km: number } | null = null;
    for (const spot of corroborated) {
      const km = haversineKm(site, spot);
      if (km > radius) continue;
      if (best === null || km < best.km) best = { spot, km };
    }

    if (!best) return { ...site, corroboration: null };

    return {
      ...site,
      corroboration: {
        feeds: best.spot.confirmedBy,
        km: Math.round(best.km * 10) / 10,
        staticHeat: best.spot.staticHeat,
      },
    };
  });
}

/**
 * Corroboration outranks the clock: a site with two feeds on the fire goes to
 * the top of the list, and sites with more agreeing feeds go above sites with
 * fewer. Within one corroboration level the existing order — least spare time
 * first — is kept, so the ranking the coordinator learned still holds.
 */
export function sortByCorroboration<T extends RankedSite>(sites: T[]): T[] {
  return [...sites]
    .map((site, index) => ({ site, index }))
    .sort((a, b) => {
      const aFeeds = a.site.corroboration?.feeds.length ?? 0;
      const bFeeds = b.site.corroboration?.feeds.length ?? 0;
      if (aFeeds !== bFeeds) return bFeeds - aFeeds;
      return a.index - b.index;
    })
    .map(({ site }) => site);
}

/** "NASA FIRMS", "EU Copernicus" — what a coordinator calls each feed. */
export const feedLabel: Record<FireFeedId, string> = {
  deepfire: "Deepfire",
  firms: "NASA FIRMS",
  effis: "EU Copernicus",
};

/** One line for the site row: who agrees, how far away. */
export function corroborationCopy(site: RankedSite): string | null {
  const check = site.corroboration;
  if (!check) return null;
  const others = check.feeds.filter((feed) => feed !== "deepfire").map((feed) => feedLabel[feed]);
  if (others.length === 0) return null;
  return `${["Deepfire", ...others].join(" + ")} agree on a fire ${check.km} km away`;
}
