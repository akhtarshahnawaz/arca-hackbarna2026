import { randomUUID } from "node:crypto";
import {
  PlaceResolver,
  StaticSourceIndex,
  cleanHotspots,
  classifySensor,
  confirmationScore,
  cql,
  describePosition,
  describeWind,
  fetchWeather,
  haversineMeters,
  type CleanResult,
  type ClusterProperties,
  type ClusterSummary,
  type ClusterSurvey,
  type Confidence,
  type Hotspot,
  type HotspotProperties,
  type Incident,
  type StaticHeatSource,
  type StaticHeatSourceProperties,
  type WatchArea,
  watchArea,
  WATCH_AREAS,
} from "@arca/core";
import type { Context } from "../context.js";
import { env } from "../env.js";
import { bus } from "../bus.js";
import { describeError } from "../logger.js";

/**
 * The watcher.
 *
 * Every few minutes: ask DeepFire what is burning inside the area of interest,
 * clean the detections, score each cluster, and open an incident for anything
 * that clears the confirmation bar. It is the only thing in ARCA that decides a
 * fire is real, so it is deliberately conservative and deliberately explainable
 * — the score that opened an incident is stored with it and shown on screen.
 *
 * The scan is split in two. `survey()` reads the feed and scores every active
 * cluster, including the ones it rejects; `tick()` decides what to do about
 * them. That split is what lets the operations screen show the whole feed — a
 * coordinator needs to see what ARCA threw away, with the reason, at least as
 * much as they need to see what it kept — without a second set of queries that
 * could disagree with the first.
 *
 * Idempotent by construction: incidents are keyed by DeepFire's cluster id, so
 * running a tick twice updates one incident rather than opening two.
 */

const STATIC_MASK_TTL_MS = 24 * 60 * 60_000;

/**
 * How long a survey is reused.
 *
 * The satellites that feed this are in polar orbit; the fastest of them
 * revisits a given point a few times a day, and the geostationary feed updates
 * every ten minutes. Re-querying more often than this costs DeepFire requests
 * and returns the same features, so an open operations screen polls the cache.
 */
const SURVEY_TTL_MS = 60_000;

const CONFIDENCE_ORDER: Confidence[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * How many cluster ids will fit in a filter before the URL does.
 *
 * `cluster_id IN (…)` is the cheap way to ask for the detections belonging to a
 * known set — until the set is a few hundred UUIDs, at which point the query
 * string is seven kilobytes and DeepFire answers 414. Above this the bounding
 * box and the time window do the filtering instead, and the results are bucketed
 * by cluster here. Same detections, shorter URL.
 */
const MAX_IDS_IN_FILTER = 60;

/**
 * How many clusters get a place name per survey.
 *
 * Nominatim's one-request-per-second policy makes naming unbounded lists
 * impossible, and naming the bottom of a 185-cluster list is pointless anyway:
 * it is collapsed behind a "scored as noise" toggle. The cache is shared across
 * surveys, so a cluster that stays in the top slice for two polls is named on
 * the first and free on the second.
 */
const NAMED_CLUSTER_LIMIT = 30;

export interface TickResult {
  clustersSeen: number;
  confirmed: string[];
  candidates: string[];
  noise: number;
  skipped: number;
  error?: string;
}

/** One cluster, scored, with the detections that scored it. */
interface ScoredCluster {
  clusterId: string;
  position: [number, number];
  props: ClusterProperties;
  cleaned: CleanResult;
  confirmation: ReturnType<typeof confirmationScore>;
  hasPerimeter: boolean;
}

export class Watcher {
  private staticIndex: StaticSourceIndex | null = null;
  private staticIndexBbox = "";
  private staticIndexFetchedAt = 0;
  private running = false;
  private places: PlaceResolver;

  /**
   * One cache entry per watch area.
   *
   * Keyed by bounding box rather than area id so an ad-hoc box gets the same
   * treatment as a named one, and so switching back to Catalonia after looking
   * at Iberia is instant rather than another round trip.
   */
  private readonly surveys = new Map<
    string,
    { survey: ClusterSurvey; scored: ScoredCluster[]; at: number }
  >();
  private readonly inFlight = new Map<string, Promise<ClusterSurvey>>();

  constructor(
    private readonly ctx: Context,
    private readonly onConfirmed: (incident: Incident) => Promise<void>,
    places?: PlaceResolver,
  ) {
    this.places = places ?? new PlaceResolver({ enabled: env.watch.placeLookup });
  }

  /**
   * The persistent-anomaly mask, refreshed daily.
   *
   * Cached hard because it changes on the scale of months and because fetching
   * a few thousand polygons on every five-minute tick would be the single
   * largest thing ARCA asks of DeepFire, for no benefit.
   */
  private async ensureStaticMask(area: WatchArea): Promise<StaticSourceIndex | null> {
    if (!this.ctx.deepfire) return null;
    const fresh = Date.now() - this.staticIndexFetchedAt < STATIC_MASK_TTL_MS;
    // A Catalan mask says nothing about a flare stack in Huelva, so widening
    // the area has to refetch it. Masking blind would be worse than not masking.
    if (this.staticIndex && fresh && this.staticIndexBbox === area.bbox) return this.staticIndex;

    try {
      const features = await this.ctx.deepfire.staticHeatSources({
        bbox: area.bbox,
        limit: 10_000,
        maxPages: 3,
      });
      const sources: StaticHeatSource[] = features
        .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
        .map((f) => {
          const props = f.properties as StaticHeatSourceProperties;
          return {
            id: String(f.id ?? randomUUID()),
            type: props.type ?? "Unknown",
            remarks: props.remarks ?? null,
            geometry: f.geometry as StaticHeatSource["geometry"],
          };
        });
      this.staticIndex = new StaticSourceIndex(sources);
      this.staticIndexBbox = area.bbox;
      this.staticIndexFetchedAt = Date.now();
      this.ctx.log.info(`Static heat-source mask loaded: ${sources.length} polygons.`);
      return this.staticIndex;
    } catch (error) {
      // Without the mask ARCA would have to either mask nothing or mask blind.
      // It masks nothing and says so, because a flare shown with a caveat is
      // better than a real fire hidden by a guess.
      this.ctx.log.error("Static heat-source mask unavailable; nothing will be masked this tick.", {
        error: describeError(error),
      });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Survey — read the feed, score everything, decide nothing
  // ---------------------------------------------------------------------------

  /**
   * Every active cluster in the area of interest, scored.
   *
   * Served from a short cache so that an operations screen polling this costs
   * nothing. `force` is what the "scan now" button sends.
   */
  async survey(options: { force?: boolean; area?: string | null } = {}): Promise<ClusterSurvey> {
    const area = this.resolveArea(options.area);
    const key = area.bbox;

    const cached = this.surveys.get(key);
    if (!options.force && cached && Date.now() - cached.at < SURVEY_TTL_MS) return cached.survey;

    const running = this.inFlight.get(key);
    if (running) return running;

    const run = this.runSurvey(area).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  /** The watch areas this deployment offers, default first. */
  areas(): WatchArea[] {
    const configured = this.resolveArea(null);
    const rest = WATCH_AREAS.filter((area) => area.bbox !== configured.bbox);
    return [configured, ...rest];
  }

  /**
   * A named area, an explicit bounding box, or the configured default.
   *
   * `AOI_BBOX` wins when it does not match a named area, so a deployment
   * watching one valley keeps watching that valley.
   */
  private resolveArea(id: string | null | undefined): WatchArea {
    const named = watchArea(id);
    if (named) return named;

    const configured = WATCH_AREAS.find((area) => area.bbox === env.watch.bbox);
    if (configured) return configured;
    return {
      id: "configured",
      label: "Area of interest",
      bbox: env.watch.bbox,
      coverage: "osm",
      note: "Custom area from AOI_BBOX.",
    };
  }

  /** The scored clusters behind a recent survey, for adoption. */
  private async scoredFor(clusterId: string): Promise<ScoredCluster | null> {
    for (const entry of this.surveys.values()) {
      const hit = entry.scored.find((scored) => scored.clusterId === clusterId);
      if (hit && Date.now() - entry.at < SURVEY_TTL_MS) return hit;
    }
    // Nothing fresh holds it. Re-read the areas we have looked at, newest first,
    // rather than guessing: a cluster adopted from Iberia is not in Catalonia.
    const keys = [...this.surveys.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .map(([key]) => key);
    for (const bbox of keys.length > 0 ? keys : [env.watch.bbox]) {
      await this.survey({ force: true, area: this.areaIdForBbox(bbox) });
      const hit = this.surveys.get(bbox)?.scored.find((scored) => scored.clusterId === clusterId);
      if (hit) return hit;
    }
    return null;
  }

  private areaIdForBbox(bbox: string): string | null {
    return WATCH_AREAS.find((area) => area.bbox === bbox)?.id ?? null;
  }

  private async runSurvey(area: WatchArea): Promise<ClusterSurvey> {
    const at = new Date().toISOString();
    const base = {
      bbox: area.bbox,
      areaId: area.id,
      areaLabel: area.label,
      coverage: area.coverage,
      at,
    };

    if (!this.ctx.deepfire) {
      return { ...base, clusters: [], error: "DeepFire is not configured.", maskIncomplete: true };
    }

    try {
      const staticIndex = await this.ensureStaticMask(area);

      const clusterFeatures = await this.ctx.deepfire.clusters({
        bbox: area.bbox,
        filter: cql.activeClustersRecent(env.watch.clusterLookbackHours),
        limit: 2_000,
        maxPages: 3,
      });

      const clusterIds = clusterFeatures
        .map((f) => String(f.id ?? "").replace(/^clusters\./, ""))
        .filter(Boolean);

      if (clusterIds.length === 0) {
        const empty: ClusterSurvey = { ...base, clusters: [], error: null, maskIncomplete: !staticIndex };
        this.surveys.set(area.bbox, { survey: empty, scored: [], at: Date.now() });
        return empty;
      }

      // One query for every cluster's detections rather than one per cluster:
      // the API charges by request shape, and a single IN filter over a bounded
      // set is far cheaper than fifty round trips. The same applies to
      // perimeters, which used to be fetched one cluster at a time.
      const narrow = clusterIds.length <= MAX_IDS_IN_FILTER;
      const [hotspotFeatures, perimeterClusterIds] = await Promise.all([
        this.ctx.deepfire.hotspots({
          bbox: area.bbox,
          filter: cql.and(
            narrow ? cql.hotspotsForClusters(clusterIds) : null,
            cql.since("observed_at", cql.hoursAgo(24)),
          ),
          limit: 10_000,
          maxPages: 5,
        }),
        this.perimeterClusterIds(clusterIds, narrow, area.bbox),
      ]);

      // Without the IN filter the bbox returns detections from clusters that
      // are no longer active too. Only the ones we asked about are kept.
      const wanted = new Set(clusterIds);

      const byCluster = new Map<string, Hotspot[]>();
      for (const feature of hotspotFeatures) {
        const props = feature.properties as HotspotProperties;
        const geometry = feature.geometry;
        if (!geometry || geometry.type !== "Point") continue;
        const [lon, lat] = geometry.coordinates as [number, number];
        const clusterId = props.cluster_id ?? "";
        if (!clusterId || !wanted.has(clusterId)) continue;

        const hotspot: Hotspot = {
          id: String(feature.id ?? randomUUID()).replace(/^hotspots\./, ""),
          clusterId,
          position: [lon, lat],
          observedAt: props.observed_at,
          source: props.source,
          sensorClass: classifySensor(props.source),
          confidence: props.confidence,
          fireRadiativePowerMw: props.fire_radiative_power,
          country: props.country,
          active: props.active,
        };
        const bucket = byCluster.get(clusterId);
        if (bucket) bucket.push(hotspot);
        else byCluster.set(clusterId, [hotspot]);
      }

      const scored: ScoredCluster[] = [];
      for (const feature of clusterFeatures) {
        const clusterId = String(feature.id ?? "").replace(/^clusters\./, "");
        const props = feature.properties as ClusterProperties;
        const geometry = feature.geometry;
        if (!clusterId || !geometry || geometry.type !== "Point") continue;
        const hotspots = byCluster.get(clusterId) ?? [];
        // A cluster with no detections inside the window has nothing to score
        // and nothing to show. It is not evidence of anything either way.
        if (hotspots.length === 0) continue;

        const cleaned = cleanHotspots(hotspots, {
          staticIndex,
          maskComplete: Boolean(staticIndex),
        });
        const hasPerimeter = perimeterClusterIds.has(clusterId);

        scored.push({
          clusterId,
          position: [geometry.coordinates[0] as number, geometry.coordinates[1] as number],
          props,
          cleaned,
          confirmation: confirmationScore(cleaned, { hasPerimeter }),
          hasPerimeter,
        });
      }

      const clusters = await this.describe(scored);

      const survey: ClusterSurvey = { ...base, clusters, error: null, maskIncomplete: !staticIndex };
      this.surveys.set(area.bbox, { survey, scored, at: Date.now() });
      return survey;
    } catch (error) {
      const message = describeError(error);
      this.ctx.log.error("Cluster survey failed", { error: message });
      // A failed poll must not blank a screen that was working a minute ago.
      // Serve the last good survey, labelled with the failure.
      return {
        ...base,
        clusters: this.surveys.get(area.bbox)?.survey.clusters ?? [],
        error: message,
        maskIncomplete: !this.staticIndex,
      };
    }
  }

  /** Which of these clusters DeepFire has fitted a perimeter to. One query. */
  private async perimeterClusterIds(
    clusterIds: string[],
    narrow: boolean,
    bbox: string,
  ): Promise<Set<string>> {
    if (!this.ctx.deepfire || clusterIds.length === 0) return new Set();
    try {
      const wanted = new Set(clusterIds);
      const features = await this.ctx.deepfire.perimeters({
        // Same URL-length problem as the hotspot query; same answer.
        filter: narrow ? cql.inList("cluster_id", clusterIds) : undefined,
        bbox: narrow ? undefined : bbox,
        limit: 2_000,
        maxPages: 2,
      });
      return new Set(
        features
          .map((feature) => String((feature.properties as { cluster_id?: string })?.cluster_id ?? ""))
          .filter((id) => id && wanted.has(id)),
      );
    } catch {
      // Absence of evidence: score without the perimeter bonus rather than
      // failing the whole survey because one optional lookup timed out.
      return new Set();
    }
  }

  /** Turn scored clusters into something a person can choose between. */
  private async describe(scored: ScoredCluster[]): Promise<ClusterSummary[]> {
    const incidents = await this.ctx.store
      .listIncidents({})
      .catch(() => [] as Incident[]);
    const byCluster = new Map(incidents.map((incident) => [incident.clusterId, incident]));

    /**
     * Names, for the clusters anyone is going to read.
     *
     * Nominatim allows one request a second, so naming all 185 clusters of an
     * Iberia-wide survey would take three minutes of queue for a list whose
     * bottom nine tenths is collapsed behind "scored as noise". The ones worth
     * naming are the ones at the top: already being worked, then above the bar,
     * then by score. The rest fall back to coordinates, which are always
     * correct if less friendly.
     */
    const order = scored
      .map((entry, index) => ({ index, entry }))
      .sort(
        (a, b) =>
          Number(Boolean(byCluster.get(b.entry.clusterId))) -
            Number(Boolean(byCluster.get(a.entry.clusterId))) ||
          b.entry.confirmation.score - a.entry.confirmation.score,
      )
      .slice(0, NAMED_CLUSTER_LIMIT);

    const names = new Map<number, string | null>();
    const resolved = await this.places.resolveMany(
      order.map((item) => item.entry.position),
      { budgetMs: 3_000 },
    );
    order.forEach((item, i) => names.set(item.index, resolved[i] ?? null));

    return scored.map((entry, index) => {
      const usable = entry.cleaned.usable;
      const frps = usable
        .map((hotspot) => hotspot.fireRadiativePowerMw)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const incident = byCluster.get(entry.clusterId) ?? null;

      return {
        clusterId: entry.clusterId,
        position: entry.position,
        place: names.get(index) ?? null,
        firstObserved: entry.props.first_observed,
        lastObserved: entry.props.last_observed,
        detections: usable.length,
        rawDetections: entry.cleaned.hotspots.length,
        maskedDetections: entry.cleaned.counts.static_source,
        dropped: droppedReasons(entry.cleaned.counts),
        sources: [...new Set(entry.cleaned.hotspots.map((hotspot) => hotspot.source))].sort(),
        corroboratingSources: entry.confirmation.distinctSources,
        totalFrpMw: frps.length > 0 ? Number(frps.reduce((sum, value) => sum + value, 0).toFixed(1)) : null,
        maxFrpMw: frps.length > 0 ? Number(Math.max(...frps).toFixed(1)) : null,
        confidence: strongestConfidence(usable.map((hotspot) => hotspot.confidence)),
        spanM: Math.round(spanOf(usable.map((hotspot) => hotspot.position))),
        hasPerimeter: entry.hasPerimeter,
        score: entry.confirmation.score,
        classification: entry.confirmation.classification,
        incidentId: incident?.id ?? null,
        incidentStatus: incident?.status ?? null,
      } satisfies ClusterSummary;
    });
  }

  // ---------------------------------------------------------------------------
  // Tick — act on the survey
  // ---------------------------------------------------------------------------

  async tick(): Promise<TickResult> {
    if (this.running) {
      return { clustersSeen: 0, confirmed: [], candidates: [], noise: 0, skipped: 0, error: "tick already running" };
    }
    if (!this.ctx.deepfire) {
      return { clustersSeen: 0, confirmed: [], candidates: [], noise: 0, skipped: 0, error: "DeepFire not configured" };
    }

    this.running = true;
    const result: TickResult = { clustersSeen: 0, confirmed: [], candidates: [], noise: 0, skipped: 0 };

    try {
      const area = this.resolveArea(null);
      const survey = await this.survey({ force: true, area: area.id });
      result.clustersSeen = survey.clusters.length;
      if (survey.error) return { ...result, error: survey.error };

      const scored = this.surveys.get(area.bbox)?.scored ?? [];
      if (scored.length === 0) {
        this.ctx.log.info("No active clusters in the area of interest.");
        return result;
      }

      for (const entry of scored) {
        if (entry.confirmation.classification === "NOISE") {
          result.noise++;
          await this.closeIfOpen(entry.clusterId, entry.confirmation.components[0]?.detail ?? "Scored as noise.");
          continue;
        }

        const incident = await this.upsertIncident(entry);
        if (entry.confirmation.classification === "CONFIRMED") result.confirmed.push(incident.id);
        else result.candidates.push(incident.id);
      }

      this.ctx.log.info(
        `Tick complete: ${result.clustersSeen} clusters, ${result.confirmed.length} confirmed, ${result.candidates.length} candidates, ${result.noise} noise.`,
      );
      return result;
    } catch (error) {
      const message = describeError(error);
      this.ctx.log.error("Watcher tick failed", { error: message });
      return { ...result, error: message };
    } finally {
      this.running = false;
    }
  }

  /**
   * Work a cluster the watcher would not have opened on its own.
   *
   * The confirmation bar exists so ARCA does not wake anyone for a flare, and
   * it stays where it is. This is the other half of that contract: a
   * coordinator looking at the feed can point at any cluster and say "work
   * that one", and the incident it opens records that a human asked for it and
   * what the score was at the time. Nothing about the pipeline changes — the
   * same cleaning, the same simulation, the same ranking, the same caveats.
   */
  async adopt(clusterId: string): Promise<Incident | null> {
    const existing = await this.ctx.store.getIncidentByCluster(clusterId);
    const entry = await this.scoredFor(clusterId);

    if (!entry) {
      // It may have gone out between the screen rendering and the click. An
      // incident already open for it is still perfectly workable.
      return existing ?? null;
    }

    const incident = await this.upsertIncident(entry, { adopted: !existing });
    return incident;
  }

  private async upsertIncident(
    input: ScoredCluster,
    options: { adopted?: boolean } = {},
  ): Promise<Incident> {
    const existing = await this.ctx.store.getIncidentByCluster(input.clusterId);
    const now = new Date().toISOString();

    const name = existing?.name ?? (await this.nameFor(input.position));
    const wasConfirmed = existing?.status === "confirmed" || existing?.status === "monitoring";
    const nowConfirmed = input.confirmation.classification === "CONFIRMED";

    const incident: Incident = {
      id: existing?.id ?? randomUUID(),
      clusterId: input.clusterId,
      name,
      status: nowConfirmed ? (existing?.status === "monitoring" ? "monitoring" : "confirmed") : "candidate",
      replay: existing?.replay ?? false,
      position: input.position,
      firstObserved: input.props.first_observed,
      lastObserved: input.props.last_observed,
      confirmation: input.confirmation,
      weather: existing?.weather ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!incident.weather) {
      incident.weather = await fetchWeather(input.position);
    }

    await this.ctx.store.upsertIncident(incident);
    await this.ctx.store.saveHotspots(incident.id, input.cleaned.hotspots);

    if (!existing) {
      await this.ctx.timeline(
        incident.id,
        "detected",
        `${input.cleaned.usable.length} usable detections from ${input.confirmation.distinctSources.length} satellite${
          input.confirmation.distinctSources.length === 1 ? "" : "s"
        }. ${input.cleaned.counts.static_source} masked as known heat sources. ${describeWind(incident.weather)}`,
        { data: { counts: input.cleaned.counts, score: input.confirmation.score } },
      );
    }

    bus.publish({ type: "incident", incidentId: incident.id, reason: existing ? "updated" : "opened" });

    // The transition into CONFIRMED is what starts the pipeline, and it happens
    // exactly once per incident: a cluster that keeps growing must not
    // re-trigger a briefing every five minutes. An operator adopting a cluster
    // below the bar is the other way in, and it is recorded as such.
    const adopted = options.adopted === true && !nowConfirmed;

    if (adopted) {
      await this.ctx.timeline(
        incident.id,
        "status_changed",
        `Opened by an operator at ${input.confirmation.score}/100, below the ${
          input.confirmation.classification === "NOISE" ? "noise" : "confirmation"
        } threshold. ${input.confirmation.components
          .filter((component) => component.points > 0)
          .map((component) => component.label.toLowerCase())
          .join(", ") || "No positive evidence."}`,
        { actor: "ops-ui", data: { components: input.confirmation.components, adopted: true } },
      );
    }

    if ((nowConfirmed && !wasConfirmed) || adopted) {
      if (nowConfirmed && !wasConfirmed) {
        await this.ctx.timeline(
          incident.id,
          "confirmed",
          `Confirmed at ${input.confirmation.score}/100: ${input.confirmation.components
            .filter((component) => component.points > 0)
            .map((component) => component.label.toLowerCase())
            .join(", ")}.`,
          { data: { components: input.confirmation.components } },
        );
      }
      await this.onConfirmed(incident).catch((error) => {
        this.ctx.log.error("Incident pipeline failed", {
          incidentId: incident.id,
          error: describeError(error),
        });
      });
    }

    return incident;
  }

  /** A place name beats a UUID on a wall display. Falls back to coordinates. */
  private async nameFor(position: [number, number]): Promise<string> {
    const place = await this.places.resolve(position).catch(() => null);
    return place ?? describePosition(position);
  }

  private async closeIfOpen(clusterId: string, reason: string): Promise<void> {
    const existing = await this.ctx.store.getIncidentByCluster(clusterId);
    if (!existing || existing.status === "closed") return;
    await this.ctx.store.upsertIncident({ ...existing, status: "closed", updatedAt: new Date().toISOString() });
    await this.ctx.timeline(existing.id, "status_changed", `Incident closed: ${reason}`);
  }
}

/**
 * Why detections were dropped, in the words the UI shows.
 *
 * Ordered by count, because when a cluster is rejected there is usually one
 * dominant reason and the operator only needs that one.
 */
function droppedReasons(counts: CleanResult["counts"]): Array<{ reason: string; count: number }> {
  const labels: Array<[keyof CleanResult["counts"], string]> = [
    ["static_source", "known heat source"],
    ["low_confidence_uncorroborated", "low confidence, nothing to corroborate it"],
    ["duplicate", "the same pixel reported twice"],
    ["stale", "too old to act on"],
    ["outside_aoi", "outside the area of interest"],
  ];
  return labels
    .map(([key, reason]) => ({ reason, count: counts[key] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** The strongest grade any detection carried, for a one-glance quality read. */
function strongestConfidence(values: Array<Confidence | undefined>): Confidence | null {
  let best = -1;
  for (const value of values) {
    if (!value) continue;
    const index = CONFIDENCE_ORDER.indexOf(value);
    if (index > best) best = index;
  }
  return best >= 0 ? CONFIDENCE_ORDER[best]! : null;
}

/**
 * The greatest distance between any two detections.
 *
 * A proxy for how big the thing is, and one of the few size signals available
 * before a perimeter exists. Quadratic, which is fine: a cluster with more than
 * a few hundred detections is rare and the loop is arithmetic.
 */
function spanOf(positions: Array<[number, number]>): number {
  if (positions.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const distance = haversineMeters(positions[i]!, positions[j]!);
      if (distance > max) max = distance;
    }
  }
  return max;
}
