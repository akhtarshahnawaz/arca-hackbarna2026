import { haversineMeters } from "../geo/index.js";
import { cleaningPolicy } from "../config/index.js";
import type {
  CleanedHotspot,
  ConfirmationClass,
  ConfirmationResult,
  Hotspot,
  HotspotFlag,
  ScoreComponent,
} from "../domain/types.js";
import type { StaticSourceIndex } from "./mask.js";
import { bufferMetersFor } from "./mask.js";
import { classifySensor, isGeostationary, sensorInfo, sensorLabel } from "./sources.js";

const CONFIDENCE_RANK: Record<string, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };

/**
 * Which of two detections of the same pixel to keep.
 *
 * Confidence leads, because a HIGH grade and a LOW grade for the same ground
 * are not two opinions of equal weight. Radiative power only breaks ties within
 * a grade. Ordering these the other way round let a LOW pixel that happened to
 * report marginally more energy suppress the HIGH one beside it, and the
 * cluster then looked less certain than the data actually was.
 */
function strengthOf(hotspot: { confidence: string; fireRadiativePowerMw: number | null }): number {
  const grade = CONFIDENCE_RANK[hotspot.confidence] ?? 0;
  return grade * 1_000_000 + (hotspot.fireRadiativePowerMw ?? 0);
}

/** Half a pixel footprint, floored, so "same pixel" means the same thing everywhere. */
export function duplicateRadiusMeters(source: string): number {
  const resolution = sensorInfo(source)?.resolutionM ?? 1000;
  return Math.max(
    cleaningPolicy.duplicateRadiusMinMeters,
    resolution * cleaningPolicy.duplicateRadiusFractionOfPixel,
  );
}

export interface CleanOptions {
  staticIndex?: StaticSourceIndex | null;
  /** Wall-clock reference, injectable so replay can clean "as of" a past time. */
  now?: Date;
  /** Set false when the mask could not be fetched, so nothing is masked blind. */
  maskComplete?: boolean;
}

export interface CleanResult {
  hotspots: CleanedHotspot[];
  usable: CleanedHotspot[];
  masked: CleanedHotspot[];
  counts: Record<HotspotFlag | "usable", number>;
  maskComplete: boolean;
}

/**
 * Turn raw detections into an ignition set, keeping every rejected pixel with
 * the reason it was rejected.
 *
 * Nothing is deleted. A coordinator who sees a bright pixel on another system
 * and not on ours must be able to find it here, greyed out, with a sentence
 * saying why — "this is the Tarragona refinery flare" is an answer; a missing
 * dot is not.
 */
export function cleanHotspots(raw: Hotspot[], options: CleanOptions = {}): CleanResult {
  const now = options.now ?? new Date();
  const maskComplete = options.maskComplete ?? Boolean(options.staticIndex);
  const policy = cleaningPolicy;

  // Cluster-level context has to exist before per-pixel rules can run: whether
  // a LOW pixel survives depends on what the rest of its cluster looks like.
  const byCluster = new Map<string, Hotspot[]>();
  for (const hotspot of raw) {
    const key = hotspot.clusterId ?? `orphan:${hotspot.id}`;
    const bucket = byCluster.get(key);
    if (bucket) bucket.push(hotspot);
    else byCluster.set(key, [hotspot]);
  }

  const clusterHasHigh = new Map<string, boolean>();
  const clusterSourceCount = new Map<string, number>();
  for (const [key, members] of byCluster) {
    clusterHasHigh.set(key, members.some((h) => h.confidence === "HIGH"));
    clusterSourceCount.set(key, new Set(members.map((h) => h.source)).size);
  }

  const cleaned: CleanedHotspot[] = [];

  // Sorted only so the output is stable for replay and snapshot tests; no rule
  // below depends on the order, which is what makes the result reproducible.
  const ordered = [...raw].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.id.localeCompare(b.id),
  );

  for (const hotspot of ordered) {
    const flags: HotspotFlag[] = [];
    let reason: string | null = null;
    let staticSourceName: string | null = null;
    let staticSourceType: string | null = null;

    const sensorClass = classifySensor(hotspot.source);
    const clusterKey = hotspot.clusterId ?? `orphan:${hotspot.id}`;

    // R2 — static heat sources. Runs first because a masked pixel should not
    // then be reported as "low confidence": the reason a judge needs is the
    // refinery, not the grade.
    if (options.staticIndex) {
      const hit = options.staticIndex.lookup(hotspot.position, sensorClass);
      if (hit) {
        flags.push("static_source");
        staticSourceName = hit.remarks ?? hit.type;
        staticSourceType = hit.type;
        reason = `Known persistent heat source (${hit.type}${
          hit.remarks ? `: ${hit.remarks}` : ""
        }) within ${bufferMetersFor(sensorClass)} m of this ${sensorLabel(hotspot.source)} pixel.`;
      }
    }

    // R3 — a LOW pixel on its own is glint or a flare as often as it is fire.
    if (
      flags.length === 0 &&
      policy.lowConfidenceNeedsCorroboration &&
      hotspot.confidence === "LOW"
    ) {
      const corroborated =
        clusterHasHigh.get(clusterKey) === true ||
        (clusterSourceCount.get(clusterKey) ?? 0) >= 2;
      if (!corroborated) {
        flags.push("low_confidence_uncorroborated");
        reason =
          "Low-confidence detection with no high-confidence pixel and no second satellite in the same cluster.";
      }
    }

    // R5 — old pixels stay on the map as history but must not seed a model run.
    if (flags.length === 0) {
      const ageHours = (now.getTime() - Date.parse(hotspot.observedAt)) / 3_600_000;
      if (ageHours > policy.staleHours) {
        flags.push("stale");
        reason = `Observed ${Math.round(ageHours)} h ago, older than the ${policy.staleHours} h ignition window.`;
      }
    }

    const record: CleanedHotspot = {
      ...hotspot,
      sensorClass,
      flags,
      reason,
      staticSourceName,
      staticSourceType,
      usable: flags.length === 0,
    };

    cleaned.push(record);
  }

  markDuplicates(cleaned);

  const counts = {
    outside_aoi: 0,
    static_source: 0,
    low_confidence_uncorroborated: 0,
    duplicate: 0,
    stale: 0,
    usable: 0,
  } as Record<HotspotFlag | "usable", number>;

  for (const hotspot of cleaned) {
    if (hotspot.usable) counts.usable++;
    for (const flag of hotspot.flags) counts[flag]++;
  }

  return {
    hotspots: cleaned,
    usable: cleaned.filter((h) => h.usable),
    masked: cleaned.filter((h) => h.flags.includes("static_source")),
    counts,
    maskComplete,
  };
}

/**
 * Suppress same-sensor re-reports of the same pixel, in place.
 *
 * A separate pass rather than a rule inside the main loop, because the decision
 * is about a *group*: the strongest reading of a pixel wins regardless of which
 * record happened to arrive first. A forward scan could only ever suppress the
 * later one, so a weak pixel delivered a minute early survived and the
 * high-confidence reading beside it was discarded — exactly backwards.
 *
 * Candidates come from a spatial-temporal hash sized from the sensor's own
 * footprint, and the lookup sweeps the 26 neighbouring cells as well as the
 * home cell. Checking only the home cell is the classic boundary bug: two
 * detections five minutes and one metre apart can still fall either side of a
 * cell edge and never be compared.
 */
function markDuplicates(cleaned: CleanedHotspot[]): void {
  const windowMs = cleaningPolicy.duplicateWindowMinutes * 60_000;

  // One index per sensor: cell key -> detections. Cell size follows the pixel.
  const bySource = new Map<string, Map<string, CleanedHotspot[]>>();
  const cellSizeFor = (source: string) => duplicateRadiusMeters(source) / 111_320;

  const cellKey = (hotspot: CleanedHotspot, cell: number): [number, number, number] => [
    Math.floor(hotspot.position[0] / cell),
    Math.floor(hotspot.position[1] / cell),
    Math.floor(Date.parse(hotspot.observedAt) / windowMs),
  ];

  for (const hotspot of cleaned) {
    if (!hotspot.usable) continue;
    const cell = cellSizeFor(hotspot.source);
    const [x, y, t] = cellKey(hotspot, cell);
    let index = bySource.get(hotspot.source);
    if (!index) {
      index = new Map();
      bySource.set(hotspot.source, index);
    }
    const key = `${x}|${y}|${t}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(hotspot);
    else index.set(key, [hotspot]);
  }

  // Strongest first, so a winner is never itself suppressed later.
  const ordered = [...cleaned]
    .filter((h) => h.usable)
    .sort((a, b) => strengthOf(b) - strengthOf(a) || a.id.localeCompare(b.id));

  for (const winner of ordered) {
    if (!winner.usable) continue;
    const index = bySource.get(winner.source);
    if (!index) continue;

    const cell = cellSizeFor(winner.source);
    const radius = duplicateRadiusMeters(winner.source);
    const [x, y, t] = cellKey(winner, cell);
    const winnerMs = Date.parse(winner.observedAt);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dt = -1; dt <= 1; dt++) {
          const neighbours = index.get(`${x + dx}|${y + dy}|${t + dt}`);
          if (!neighbours) continue;
          for (const candidate of neighbours) {
            if (candidate === winner || !candidate.usable) continue;
            if (Math.abs(Date.parse(candidate.observedAt) - winnerMs) > windowMs) continue;
            if (haversineMeters(candidate.position, winner.position) > radius) continue;
            candidate.flags.push("duplicate");
            candidate.usable = false;
            candidate.reason = `Same sensor re-reported this pixel within ${cleaningPolicy.duplicateWindowMinutes} min and ${Math.round(radius)} m; kept the stronger ${winner.confidence.toLowerCase()}-confidence detection.`;
          }
        }
      }
    }
  }
}

/**
 * How much to believe this is a real wildfire, as an auditable sum.
 *
 * A single number would be a black box. The components are returned so the UI
 * can show the arithmetic and the agent can quote it: "two satellites agree and
 * it has been burning for forty minutes" is a defensible reason to wake someone.
 */
export function confirmationScore(
  cleaned: CleanResult,
  opts: { hasPerimeter?: boolean } = {},
): ConfirmationResult {
  const c = cleaningPolicy.confirmation;
  const usable = cleaned.usable;
  const components: ScoreComponent[] = [];

  const distinctSources = [...new Set(usable.map((h) => h.source))];
  const maxFrp = usable.reduce<number | null>(
    (max, h) => (h.fireRadiativePowerMw == null ? max : Math.max(max ?? 0, h.fireRadiativePowerMw)),
    null,
  );

  if (usable.length === 0) {
    components.push({
      key: "all_masked",
      label: "No usable detections",
      points: c.allMaskedPenalty,
      detail:
        cleaned.masked.length > 0
          ? `Every detection sits on a known static heat source (${cleaned.masked.length} masked).`
          : "No detection survived cleaning.",
    });
    return {
      score: 0,
      classification: "NOISE",
      components,
      distinctSources,
      usableHotspots: 0,
      maxFrpMw: null,
      maskedHotspots: cleaned.masked.length,
    };
  }

  // A credible detection is worth something on its own. Scoring only
  // corroboration filed a real fire seen once by one polar satellite as noise,
  // which is the opposite of what an early-warning system should do.
  const credible = usable.filter(
    (h) => !isGeostationary(h.source) && h.confidence !== "LOW",
  );
  if (credible.length > 0) {
    components.push({
      key: "credible_detection",
      label: "Credible detection",
      points: c.credibleDetectionPoints,
      detail: `${credible.length} polar-orbit detection${
        credible.length === 1 ? "" : "s"
      } graded MEDIUM or better.`,
    });
  }

  if (distinctSources.length >= c.multiSourceMinimum) {
    components.push({
      key: "multi_source",
      label: "Independent satellites agree",
      points: c.multiSourcePoints,
      detail: `${distinctSources.length} sources: ${distinctSources.join(", ")}.`,
    });
  }

  const times = usable.map((h) => Date.parse(h.observedAt)).sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  const spanMinutes = first != null && last != null ? (last - first) / 60_000 : 0;
  if (spanMinutes >= c.temporalPersistenceMinutes) {
    components.push({
      key: "persistence",
      label: "Persisted across passes",
      points: c.temporalPersistencePoints,
      detail: `Detections span ${Math.round(spanMinutes)} min, above the ${c.temporalPersistenceMinutes} min floor.`,
    });
  }

  if (usable.some((h) => h.confidence === "HIGH")) {
    components.push({
      key: "high_confidence",
      label: "High-confidence pixel present",
      points: c.highConfidencePoints,
      detail: `${usable.filter((h) => h.confidence === "HIGH").length} of ${usable.length} detections graded HIGH.`,
    });
  }

  if (maxFrp != null && maxFrp >= c.frpStrongMw) {
    components.push({
      key: "frp_strong",
      label: "Strong radiative power",
      points: c.frpStrongPoints,
      detail: `Peak FRP ${maxFrp.toFixed(1)} MW, above ${c.frpStrongMw} MW.`,
    });
  } else if (maxFrp != null && maxFrp >= c.frpModerateMw) {
    components.push({
      key: "frp_moderate",
      label: "Moderate radiative power",
      points: c.frpModeratePoints,
      detail: `Peak FRP ${maxFrp.toFixed(1)} MW, above ${c.frpModerateMw} MW.`,
    });
  }

  if (opts.hasPerimeter) {
    components.push({
      key: "perimeter",
      label: "Satellite perimeter computed",
      points: c.perimeterPoints,
      detail: "DeepFire has fitted a perimeter polygon to this cluster.",
    });
  }

  if (usable.every((h) => isGeostationary(h.source))) {
    components.push({
      key: "geostationary_only",
      label: "Geostationary only",
      points: c.geostationaryOnlyPenalty,
      detail:
        "Every surviving detection is from a 2–3 km geostationary pixel with no polar-orbit confirmation yet.",
    });
  }

  const score = Math.max(0, Math.min(100, components.reduce((sum, x) => sum + x.points, 0)));
  const classification: ConfirmationClass =
    score >= c.confirmedAt ? "CONFIRMED" : score >= c.candidateAt ? "CANDIDATE" : "NOISE";

  return {
    score,
    classification,
    components,
    distinctSources,
    usableHotspots: usable.length,
    maxFrpMw: maxFrp,
    maskedHotspots: cleaned.masked.length,
  };
}
