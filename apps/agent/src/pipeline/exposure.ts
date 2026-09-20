import { randomUUID } from "node:crypto";
import {
  rankSites,
  rankingDiff,
  type BandFeatureCollection,
  type ExposureReport,
  type Incident,
  type RankingResult,
  type SiteReport,
  type SiteStatus,
  type Simulation,
} from "@arca/core";
import type { SiteRecord } from "@arca/db";
import type { Context } from "../context.js";
import { env } from "../env.js";
import { bus } from "../bus.js";
import { describeError } from "../logger.js";

/**
 * Bands to exposure to ranking.
 *
 * The three steps are one unit because they only make sense together: an
 * exposure report with no ranking is a list of buildings, and a ranking with no
 * exposure has nothing to rank. Keeping them in one function also keeps the
 * ranking version monotonic, which is what the diff depends on.
 */

export interface RankOutcome {
  exposure: ExposureReport | null;
  ranking: RankingResult | null;
  version: number;
  degraded: string | null;
}

export class ExposureService {
  /**
   * `offlineExposure` supplies a bundled exposure report for replay incidents.
   *
   * Without it, replay only works when Talaia is reachable — which would make
   * the one feature that exists to survive a missing upstream depend on an
   * upstream. A replay bundle carries its own exposure so the whole pipeline
   * runs on a laptop with no credentials at all.
   */
  constructor(
    private readonly ctx: Context,
    private readonly offlineExposure?: (incident: Incident) => Promise<ExposureReport | null>,
  ) {}

  async rankIncident(
    incident: Incident,
    bands: BandFeatureCollection,
    simulation: Simulation | null,
    options: { spreadRunId?: string | null; reason?: string } = {},
  ): Promise<RankOutcome> {
    if (bands.features.length === 0) {
      return { exposure: null, ranking: null, version: 0, degraded: "No arrival bands to query." };
    }

    let exposure: ExposureReport;

    if (!this.ctx.talaia) {
      const bundled = await this.offlineExposure?.(incident).catch(() => null);
      if (!bundled) {
        return { exposure: null, ranking: null, version: 0, degraded: "Talaia is not configured." };
      }
      await this.ctx.timeline(
        incident.id,
        "exposure_degraded",
        "Talaia is not configured. Using the exposure bundled with this replay, which is fixture data rather than a live registry query.",
      );
      exposure = { ...bundled, degraded: { mode: "fixture", reason: "Talaia not configured.", name: incident.name } };
      return this.rankFrom(incident, exposure, simulation, options, "fixture");
    }

    try {
      exposure = await this.ctx.talaia.exposure(
        {
          aoi: bands,
          // A 250 m buffer is not padding: a care home's registered point is
          // its address, and a fire at the fence line is at the building.
          buffer_m: 250,
          include_population_grid: true,
          include_networks: false,
          sort_by: "priority",
        },
        { cacheKey: incident.id, fixtureName: incident.replay ? incident.name : undefined },
      );
    } catch (error) {
      const message = describeError(error);
      await this.ctx.timeline(
        incident.id,
        "exposure_degraded",
        `Exposure unavailable: ${message}. The incident stays open with bands only.`,
      );
      return { exposure: null, ranking: null, version: 0, degraded: message };
    }

    return this.rankFrom(incident, exposure, simulation, options, exposure.degraded?.mode ?? "full");
  }

  /** Rank an exposure report, whatever produced it. */
  private async rankFrom(
    incident: Incident,
    exposure: ExposureReport,
    simulation: Simulation | null,
    options: { spreadRunId?: string | null; reason?: string },
    degradedMode: string,
  ): Promise<RankOutcome> {
    if (degradedMode !== "full" && degradedMode !== "fixture") {
      const reason =
        "reason" in (exposure.degraded ?? {}) ? (exposure.degraded as { reason: string }).reason : "";
      await this.ctx.timeline(
        incident.id,
        "exposure_degraded",
        `Exposure served in ${degradedMode.replace(/_/g, " ")} mode. ${reason}`.trim(),
        { data: { degraded: exposure.degraded } },
      );
    }

    for (const warning of exposure.warnings ?? []) {
      this.ctx.log.warn("Talaia warning", { incidentId: incident.id, warning });
    }

    // Carry forward everything the coordinator has established. A re-rank
    // recomputes urgency; it must never forget that a site already answered the
    // phone or was marked evacuated.
    const existing = await this.ctx.store.getSites(incident.id);
    const reports = new Map<string, SiteReport>();
    const statuses = new Map<string, SiteStatus>();
    for (const site of existing) {
      if (site.reported) reports.set(site.assetId, site.reported);
      if (site.status !== "unnotified") statuses.set(site.assetId, site.status);
    }

    const previousVersion = existing.reduce((max, s) => Math.max(max, s.rankingVersion), 0);
    const version = previousVersion + 1;

    const ranking = rankSites(exposure, {
      simulation,
      horizonHours: env.watch.horizonHours,
      ensembleMembers: env.watch.ensembleMembers,
      reports,
      statuses,
      version,
    });

    const previousRanking = this.reconstruct(existing, previousVersion);
    const diff = rankingDiff(previousRanking, ranking);

    const records: SiteRecord[] = [...ranking.ranked, ...ranking.watch].map((site) => ({
      id: `${incident.id}:${site.assetId}`,
      incidentId: incident.id,
      assetId: site.assetId,
      rankingVersion: version,
      payload: site,
      status: site.status,
      reported: site.reported,
      rank: site.rank,
      action: site.action,
      spareMinutes: site.spareMinutes,
      updatedAt: new Date().toISOString(),
    }));

    await this.ctx.store.saveSites(incident.id, records);
    await this.ctx.store.saveExposure({
      id: randomUUID(),
      incidentId: incident.id,
      spreadRunId: options.spreadRunId ?? null,
      summary: exposure.summary,
      bands: exposure.bands,
      population: exposure.population,
      warnings: exposure.warnings ?? [],
      degraded: exposure.degraded,
      timing: exposure.timing,
      createdAt: new Date().toISOString(),
    });

    await this.ctx.timeline(
      incident.id,
      "exposure_computed",
      `${ranking.totals.sites} assets exposed: ${ranking.totals.peopleAtFacilities} people at facilities, ${ranking.totals.populationResident} residents, ${ranking.totals.livestockUnits} livestock units.`,
      { data: { warnings: exposure.warnings?.length ?? 0, degraded: degradedMode } },
    );

    if (diff.entries.length > 0 || previousVersion === 0) {
      await this.ctx.store.saveRankingDiff(incident.id, diff);
      await this.ctx.timeline(
        previousVersion === 0 ? incident.id : incident.id,
        previousVersion === 0 ? "ranked" : "reranked",
        diff.summary,
        { data: { version, entries: diff.entries } },
      );
    }

    bus.publish({ type: "ranking", incidentId: incident.id, version, summary: diff.summary });

    return { exposure, ranking, version, degraded: degradedMode === "full" ? null : degradedMode };
  }

  /**
   * Rebuild the previous ranking from stored rows so the diff has something to
   * compare against after a restart. Only the fields the diff reads are needed,
   * which is why this is a projection rather than a full rehydration.
   */
  private reconstruct(sites: SiteRecord[], version: number): RankingResult | null {
    if (sites.length === 0 || version === 0) return null;
    const payloads = sites.map((site) => site.payload);
    return {
      version,
      computedAt: sites[0]?.updatedAt ?? new Date().toISOString(),
      ranked: payloads.filter((site) => site.rank > 0).sort((a, b) => a.rank - b.rank),
      watch: payloads.filter((site) => site.rank === 0),
      totals: {
        sites: payloads.length,
        peopleAtFacilities: 0,
        populationResident: 0,
        livestockUnits: 0,
        valueEur: 0,
        evacuateNow: payloads.filter((s) => s.action === "EVACUATE_NOW").length,
        shelterCandidates: payloads.filter((s) => s.action === "SHELTER_CANDIDATE").length,
        hazardous: payloads.filter((s) => s.hazardous).length,
      },
    };
  }
}
