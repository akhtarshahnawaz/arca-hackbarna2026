import { randomUUID } from "node:crypto";
import {
  StaticSourceIndex,
  cleanHotspots,
  classifySensor,
  confirmationScore,
  cql,
  describeWind,
  fetchWeather,
  type CleanResult,
  type ClusterProperties,
  type Hotspot,
  type HotspotProperties,
  type Incident,
  type StaticHeatSource,
  type StaticHeatSourceProperties,
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
 * Idempotent by construction: incidents are keyed by DeepFire's cluster id, so
 * running a tick twice updates one incident rather than opening two.
 */

const STATIC_MASK_TTL_MS = 24 * 60 * 60_000;

export interface TickResult {
  clustersSeen: number;
  confirmed: string[];
  candidates: string[];
  noise: number;
  skipped: number;
  error?: string;
}

export class Watcher {
  private staticIndex: StaticSourceIndex | null = null;
  private staticIndexFetchedAt = 0;
  private running = false;

  constructor(
    private readonly ctx: Context,
    private readonly onConfirmed: (incident: Incident) => Promise<void>,
  ) {}

  /**
   * The persistent-anomaly mask, refreshed daily.
   *
   * Cached hard because it changes on the scale of months and because fetching
   * a few thousand polygons on every five-minute tick would be the single
   * largest thing ARCA asks of DeepFire, for no benefit.
   */
  private async ensureStaticMask(): Promise<StaticSourceIndex | null> {
    if (!this.ctx.deepfire) return null;
    const fresh = Date.now() - this.staticIndexFetchedAt < STATIC_MASK_TTL_MS;
    if (this.staticIndex && fresh) return this.staticIndex;

    try {
      const features = await this.ctx.deepfire.staticHeatSources({
        bbox: env.watch.bbox,
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
      const staticIndex = await this.ensureStaticMask();

      const clusterFeatures = await this.ctx.deepfire.clusters({
        bbox: env.watch.bbox,
        filter: cql.activeClustersRecent(12),
        limit: 2_000,
        maxPages: 3,
      });
      result.clustersSeen = clusterFeatures.length;

      if (clusterFeatures.length === 0) {
        this.ctx.log.info("No active clusters in the area of interest.");
        return result;
      }

      const clusterIds = clusterFeatures
        .map((f) => String(f.id ?? "").replace(/^clusters\./, ""))
        .filter(Boolean);

      // One query for every cluster's detections rather than one per cluster:
      // the API charges by request shape, and a single IN filter over a bounded
      // set is far cheaper than fifty round trips.
      const hotspotFeatures = await this.ctx.deepfire.hotspots({
        bbox: env.watch.bbox,
        filter: cql.and(cql.hotspotsForClusters(clusterIds), cql.since("observed_at", cql.hoursAgo(24))),
        limit: 10_000,
        maxPages: 5,
      });

      const byCluster = new Map<string, Hotspot[]>();
      for (const feature of hotspotFeatures) {
        const props = feature.properties as HotspotProperties;
        const geometry = feature.geometry;
        if (!geometry || geometry.type !== "Point") continue;
        const [lon, lat] = geometry.coordinates as [number, number];
        const clusterId = props.cluster_id ?? "";
        if (!clusterId) continue;

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

      for (const feature of clusterFeatures) {
        const clusterId = String(feature.id ?? "").replace(/^clusters\./, "");
        const props = feature.properties as ClusterProperties;
        const geometry = feature.geometry;
        if (!clusterId || !geometry || geometry.type !== "Point") {
          result.skipped++;
          continue;
        }
        const [lon, lat] = geometry.coordinates as [number, number];
        const hotspots = byCluster.get(clusterId) ?? [];
        if (hotspots.length === 0) {
          result.skipped++;
          continue;
        }

        const cleaned = cleanHotspots(hotspots, {
          staticIndex,
          maskComplete: Boolean(staticIndex),
        });

        // A perimeter only exists once DeepFire has enough detections to fit
        // one, so its presence is itself evidence — worth points in the score.
        const hasPerimeter = await this.hasPerimeter(clusterId);
        const confirmation = confirmationScore(cleaned, { hasPerimeter });

        if (confirmation.classification === "NOISE") {
          result.noise++;
          await this.closeIfOpen(clusterId, confirmation.components[0]?.detail ?? "Scored as noise.");
          continue;
        }

        const incident = await this.upsertIncident({
          clusterId,
          position: [lon, lat],
          props,
          cleaned,
          confirmation,
        });

        if (confirmation.classification === "CONFIRMED") {
          result.confirmed.push(incident.id);
        } else {
          result.candidates.push(incident.id);
        }
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

  private async hasPerimeter(clusterId: string): Promise<boolean> {
    if (!this.ctx.deepfire) return false;
    try {
      const features = await this.ctx.deepfire.perimeters({
        filter: `cluster_id = '${clusterId}'`,
        limit: 1,
        maxPages: 1,
      });
      return features.length > 0;
    } catch {
      // Absence of evidence: score without the perimeter bonus rather than
      // failing the whole cluster because one optional lookup timed out.
      return false;
    }
  }

  private async upsertIncident(input: {
    clusterId: string;
    position: [number, number];
    props: ClusterProperties;
    cleaned: CleanResult;
    confirmation: ReturnType<typeof confirmationScore>;
  }): Promise<Incident> {
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
    // re-trigger a briefing every five minutes.
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
    if (!this.ctx.talaia) return `${position[1].toFixed(3)}, ${position[0].toFixed(3)}`;
    return `${position[1].toFixed(3)}, ${position[0].toFixed(3)}`;
  }

  private async closeIfOpen(clusterId: string, reason: string): Promise<void> {
    const existing = await this.ctx.store.getIncidentByCluster(clusterId);
    if (!existing || existing.status === "closed") return;
    await this.ctx.store.upsertIncident({ ...existing, status: "closed", updatedAt: new Date().toISOString() });
    await this.ctx.timeline(existing.id, "status_changed", `Incident closed: ${reason}`);
  }
}
