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
/** A point this close to a mapped heat source counts as on it when it has no ring. */
export const heatCentroidKm = () => numberFromEnv("CROSSCHECK_HEAT_CENTROID_KM", 1);
/** MODIS confidence below this percent is too weak to corroborate. */
export const minConfidence = () => numberFromEnv("CROSSCHECK_MIN_CONFIDENCE", 30);

/**
 * When a detection was seen, in epoch ms.
 *
 * Three answers, not two. `undefined` is "the feed carries no time", which
 * skips the age test as documented. `null` is "the feed carries a time we
 * cannot read", which must fail closed: treating it like "absent" let an
 * `Invalid Date` from an epoch-millis or DD/MM/YYYY field skip the age test
 * entirely, so a months-old polygon corroborated today's hotspot.
 */
function instantMs(value: string | null): number | null | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True when a detection is too weak to count as a second opinion. VIIRS grades
 * confidence l/n/h, MODIS as a percent. A single low-confidence pixel is sun
 * glint or a gas flare as often as it is fire, and one of those was enough to
 * earn a "2 FEEDS AGREE" badge and pin a calm site above a burning one.
 */
export function isWeakDetection(confidence: string | null): boolean {
  if (!confidence) return false; // No grade published: judged on distance and age alone.
  const value = confidence.trim().toLowerCase();
  if (value === "l" || value === "low") return true;
  const percent = Number(value);
  return Number.isFinite(percent) && percent < minConfidence();
}

/**
 * The static heat source a point sits on.
 *
 * Polygon first, and for a source that has a polygon the polygon is the whole
 * answer: a centroid fallback that also ran on mapped sources threw a second,
 * blunt 1 km circle around every quarry, so a real fire 800 m outside a quarry
 * `pointInRing` had already cleared was labelled a chimney and never corroborated.
 * The centroid is only for sources that arrive without a usable ring.
 */
export function staticHeatAt(
  point: { lat: number; lon: number },
  heatSources: HeatSource[],
  toleranceKm = heatCentroidKm(),
): HeatSource | null {
  const mapped = (source: HeatSource) => source.rings.some((ring) => ring.length > 2);

  for (const source of heatSources) {
    if (!mapped(source)) continue;
    for (const ring of source.rings) {
      if (ring.length > 2 && pointInRing([point.lon, point.lat], ring)) return source;
    }
  }

  return (
    heatSources.find(
      (source) => !mapped(source) && haversineKm(point, source) <= toleranceKm,
    ) ?? null
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
  /**
   * Whether the chimney mask above is the complete one. Pass `false` when the
   * Deepfire heat query failed, its credentials are missing, or paging stopped
   * early — `heatSources` is then `[]` for a reason that is not "no chimneys
   * here", and promoting on it would corroborate every flare in Catalonia.
   */
  maskReady = true,
): CheckedHotspot[] {
  const km = matchKm();
  const hours = matchHours();

  return hotspots.map((spot) => {
    const feeds = new Set<FireFeedId>(["deepfire"]);
    let nearest: number | null = null;
    const spotMs = instantMs(spot.observedAt);

    for (const detection of detections) {
      if (detection.feed === "deepfire") continue;
      if (isWeakDetection(detection.confidence)) continue;
      const distance = haversineKm(spot, detection);
      if (!Number.isFinite(distance) || distance > km) continue;

      const detectionMs = instantMs(detection.observedAt);
      // An unreadable timestamp on either side is not an excuse to skip the
      // age test — it is a reason to decline the match.
      if (spotMs === null || detectionMs === null) continue;
      if (
        spotMs !== undefined &&
        detectionMs !== undefined &&
        Math.abs(spotMs - detectionMs) / 3_600_000 > hours
      ) {
        continue;
      }

      feeds.add(detection.feed);
      if (nearest === null || distance < nearest) nearest = distance;
    }

    const heat = staticHeatAt(spot, heatSources);

    return {
      ...spot,
      confirmedBy: [...feeds],
      matchKm: nearest === null ? null : Math.round(nearest * 100) / 100,
      staticHeat: heat ? heat.label : null,
      maskReady,
    };
  });
}

/**
 * A hotspot counts as corroborated when a second feed saw it, it is not on a
 * chimney, and we actually know whether it is on a chimney. This is the single
 * predicate: every banner, badge and marker asks it rather than re-deriving
 * "two feeds and no static heat" with its own slightly different truthiness.
 */
export function isCorroborated(spot: CheckedHotspot): boolean {
  return spot.confirmedBy.length > 1 && spot.staticHeat === null && spot.maskReady;
}

/** A hotspot the mask says is a chimney. Drawn, never promoted. */
export function isOnStaticHeat(spot: CheckedHotspot): boolean {
  return spot.staticHeat !== null;
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

/**
 * The site that is soonest out of time, whichever way the list is sorted.
 *
 * `sites[0]` is the top *row*, and after the cross-check re-sort that means
 * "most corroborated", not "least spare time". Resident broadcast copy has to
 * speak for the site actually running out of time, or a mass alert carries the
 * arrival window and shelter of a calm farm two satellites happened to agree on.
 */
export function mostUrgent<T extends RankedSite>(sites: T[]): T | undefined {
  return [...sites].sort((a, b) => {
    const aRank = a.timeRank ?? a.rank;
    const bRank = b.timeRank ?? b.rank;
    return aRank - bRank;
  })[0];
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
