import { randomUUID } from "node:crypto";
import {
  bandsFromSimulation,
  type BandFeatureCollection,
  type Incident,
  type RankedSite,
  type RankingResult,
  type SiteStatus,
  type Simulation,
} from "@arca/core";
import type { CallRecord, DecisionRecord, SiteRecord } from "@arca/db";
import type { Context } from "../context.js";
import { SpreadService } from "./spread.js";
import { ExposureService } from "./exposure.js";
import { VoiceService } from "../voice/slng.js";
import { ExtractionService } from "../voice/extraction.js";
import { buildBriefing } from "../agent/briefing.js";
import { env } from "../env.js";
import { describeError } from "../logger.js";

/**
 * The incident lifecycle, in one place.
 *
 * Detect, simulate, expose, rank, brief, approve, call, re-rank. Each step is a
 * method so the HTTP API, the Telegram bot and the agent's tools all drive the
 * same code rather than three near-copies that gradually disagree.
 *
 * The approval rule is structural rather than advisory: `dispatchApprovedCall`
 * is the only path to the voice service, and it refuses to run without a stored
 * decision. There is no code path from the language model to a ringing phone
 * that does not pass through a record of who said yes.
 */

export interface BriefResult {
  incident: Incident;
  ranking: RankingResult | null;
  briefing: string | null;
  degraded: string | null;
  synthetic: boolean;
}

export class IncidentService {
  readonly spread: SpreadService;
  readonly exposure: ExposureService;
  readonly voice: VoiceService;
  readonly extraction: ExtractionService;

  constructor(
    private readonly ctx: Context,
    private readonly notify?: (incident: Incident, text: string, ranking: RankingResult | null) => Promise<void>,
    offlineExposure?: (incident: Incident) => Promise<import("@arca/core").ExposureReport | null>,
  ) {
    this.spread = new SpreadService(ctx);
    this.exposure = new ExposureService(ctx, offlineExposure);
    this.voice = new VoiceService(ctx);
    this.extraction = new ExtractionService(ctx);
  }

  /**
   * Run the whole pipeline for a confirmed incident and brief the coordinator.
   *
   * Called when the watcher first confirms a fire, and again whenever something
   * material changes. Safe to call repeatedly: the spread service decides
   * whether a new model run is warranted, and the ranking version increments so
   * the diff can describe what moved.
   */
  async process(incident: Incident, options: { force?: boolean; notify?: boolean } = {}): Promise<BriefResult> {
    // A first look, before the model.
    //
    // DeepFire queues simulations and a run takes minutes; for those minutes
    // there is nothing on screen but a dot. Ranking a drawn footprint first
    // costs one exposure query and turns that dead time into a working list of
    // who is nearby, labelled as provisional everywhere it appears. When the
    // real run lands the ranking is recomputed and the diff says what moved.
    //
    // Only on the way in. A re-run already has geometry to show.
    await this.rankProvisionally(incident).catch((error) =>
      this.ctx.log.warn("Provisional ranking failed; waiting for the model instead.", {
        incidentId: incident.id,
        error: describeError(error),
      }),
    );

    const spread = await this.spread.ensure(incident, { force: options.force });
    const { ranking, degraded } = await this.exposure.rankIncident(
      incident,
      spread.bands,
      spread.simulation,
      { spreadRunId: spread.run.id },
    );

    if (!ranking) {
      return { incident, ranking: null, briefing: null, degraded, synthetic: spread.synthetic };
    }

    const briefing = await buildBriefing({
      incident,
      ranking,
      degraded,
      synthetic: spread.synthetic,
    });

    await this.ctx.timeline(incident.id, "briefed", briefing.text, {
      data: { generated: briefing.generated, model: briefing.model },
    });

    // Message-first: the coordinator hears about a fire that threatens people
    // without having to be watching a screen. Silence is the failure mode this
    // whole system exists to remove.
    const worthWaking = ranking.ranked.some((site) => site.humanBearing) || ranking.totals.evacuateNow > 0;
    if (options.notify !== false && worthWaking) {
      await this.notify?.(incident, briefing.text, ranking).catch((error) =>
        this.ctx.log.error("Notification failed", { error: describeError(error), incidentId: incident.id }),
      );
    }

    return { incident, ranking, briefing: briefing.text, degraded, synthetic: spread.synthetic };
  }

  /**
   * Rank on a drawn footprint, when there is nothing better yet.
   *
   * Skipped for a replay (its geometry is already recorded) and for any
   * incident that already has a completed run, so this only ever runs on the
   * one open that would otherwise be a blank screen.
   */
  private async rankProvisionally(incident: Incident): Promise<void> {
    if (incident.replay) return;

    const cached = await this.ctx.store.latestSpreadRun(incident.id).catch(() => null);
    if (cached?.status === "COMPLETED" && cached.bands) return;
    if (cached?.status === "PROVISIONAL") return;

    const provisional = await this.spread.provisional(incident);
    await this.ctx.timeline(
      incident.id,
      "note",
      "Ranking on a drawn footprint while the model runs. These figures are provisional and will be recomputed when the simulation lands.",
      { data: { provisional: true } },
    );

    await this.exposure.rankIncident(incident, provisional.bands, null, {
      spreadRunId: provisional.run.id,
      reason: "provisional footprint",
    });
  }

  /**
   * Brief the coordinator on an incident that is already worked up.
   *
   * Uses whatever the last ranking produced rather than re-running anything —
   * this is a send, not a recompute, and a button labelled "brief the
   * coordinator" that silently costs a simulation would be a trap.
   */
  async brief(incident: Incident): Promise<{ briefing: string }> {
    const sites = await this.ctx.store.getSites(incident.id);
    const ranked = sites
      .filter((site) => site.rank > 0)
      .sort((a, b) => a.rank - b.rank)
      .map((site) => site.payload);

    if (ranked.length === 0) {
      throw new Error(
        "Nothing is ranked on this incident yet, so there is nothing to brief. Wait for the exposure query to finish.",
      );
    }

    const spread = await this.ctx.store.latestSpreadRun(incident.id).catch(() => null);
    const ranking: RankingResult = {
        version: sites.reduce((max, site) => Math.max(max, site.rankingVersion), 0),
        computedAt: new Date().toISOString(),
        ranked,
        watch: sites.filter((site) => site.rank === 0).map((site) => site.payload),
        totals: {
          sites: ranked.length,
          peopleAtFacilities: ranked.reduce((sum, site) => sum + site.peopleEstimate, 0),
          populationResident: 0,
          livestockUnits: ranked.reduce((sum, site) => sum + (site.livestockUnits ?? 0), 0),
          valueEur: ranked.reduce((sum, site) => sum + (site.valueEur ?? 0), 0),
          evacuateNow: ranked.filter((site) => site.action === "EVACUATE_NOW").length,
          shelterCandidates: ranked.filter((site) => site.action === "SHELTER_CANDIDATE").length,
          hazardous: ranked.filter((site) => site.hazardous).length,
      },
    };

    const briefing = await buildBriefing({
      incident,
      ranking,
      degraded: null,
      synthetic: spread ? spread.status !== "COMPLETED" : true,
    });

    await this.notify?.(incident, briefing.text, ranking);
    await this.ctx.timeline(incident.id, "briefed", `Briefing sent to the coordinator on request.`, {
      actor: "ops-ui",
    });

    return { briefing: briefing.text };
  }

  async getIncidentOrThrow(incidentId: string): Promise<Incident> {
    const incident = await this.ctx.store.getIncident(incidentId);
    if (!incident) throw new Error(`No incident ${incidentId}`);
    return incident;
  }

  async getSiteOrThrow(incidentId: string, assetId: string): Promise<SiteRecord> {
    const site = await this.ctx.store.getSite(incidentId, assetId);
    if (!site) throw new Error(`No site ${assetId} in incident ${incidentId}`);
    return site;
  }

  /** Record a decision. The only way anything irreversible gets authorised. */
  async recordDecision(input: {
    incidentId: string;
    siteId?: string | null;
    kind: DecisionRecord["kind"];
    actor: string;
    via: DecisionRecord["via"];
    note?: string;
    payload?: unknown;
  }): Promise<DecisionRecord> {
    const decision: DecisionRecord = {
      id: randomUUID(),
      incidentId: input.incidentId,
      siteId: input.siteId ?? null,
      kind: input.kind,
      actor: input.actor,
      via: input.via,
      note: input.note ?? null,
      payload: input.payload ?? null,
      at: new Date().toISOString(),
    };
    await this.ctx.store.addDecision(decision);
    return decision;
  }

  /**
   * Dispatch a call that a human has approved.
   *
   * Records the decision first and only then talks to the voice service, so the
   * audit trail cannot be missing for a call that happened. Both the Telegram
   * button and the web button land here, which is why there is only one place
   * to audit and only one place the safety rails have to hold.
   */
  async dispatchApprovedCall(input: {
    incidentId: string;
    assetId: string;
    actor: string;
    via: DecisionRecord["via"];
    language?: "es" | "ca" | "en";
  }): Promise<{ call: CallRecord; message: string; site: RankedSite }> {
    const site = await this.getSiteOrThrow(input.incidentId, input.assetId);
    const payload = site.payload;

    await this.recordDecision({
      incidentId: input.incidentId,
      siteId: input.assetId,
      kind: "approve_call",
      actor: input.actor,
      via: input.via,
      note: `Approved a call to ${payload.name}.`,
    });
    await this.ctx.timeline(
      input.incidentId,
      "approved",
      `${input.actor} approved a call to ${payload.name} via ${input.via}.`,
      { actor: input.actor },
    );

    await this.ctx.store.updateSiteStatus(input.incidentId, input.assetId, "calling");

    const script = this.voice.buildScript(payload, input.language ?? "es");
    const result = await this.voice.dispatch({
      incidentId: input.incidentId,
      site: payload,
      script,
      approvedBy: input.actor,
    });

    if (result.call.status === "failed") {
      await this.ctx.store.updateSiteStatus(input.incidentId, input.assetId, "unreachable");
    }

    // Watch for the transcript in the background so the caller is not blocked
    // for the length of a phone call.
    if (result.call.providerCallId) {
      void this.awaitReport(input.incidentId, input.assetId, result.call.id).catch((error) =>
        this.ctx.log.error("Report handling failed", {
          error: describeError(error),
          callId: result.call.id,
        }),
      );
    }

    return { call: result.call, message: result.message, site: payload };
  }

  /** Wait for a call to end, extract what was said, and re-rank on it. */
  private async awaitReport(incidentId: string, assetId: string, callId: string): Promise<void> {
    const finished = await this.voice.collect(callId);
    if (!finished?.transcript) {
      await this.ctx.timeline(
        incidentId,
        "call_completed",
        "Call ended with no transcript. Nothing was changed on the strength of it.",
        { data: { callId } },
      );
      return;
    }
    await this.applyTranscript({ incidentId, assetId, callId, transcript: finished.transcript });
  }

  /**
   * Turn a transcript into a report and re-rank.
   *
   * Also the path a coordinator uses to paste a transcript by hand, which is
   * how the workflow stays whole when telephony is unavailable.
   */
  async applyTranscript(input: {
    incidentId: string;
    assetId: string;
    transcript: string;
    callId?: string;
    source?: "phone" | "manual" | "telegram";
  }): Promise<{ summary: string; reranked: boolean }> {
    const site = await this.getSiteOrThrow(input.incidentId, input.assetId);

    const outcome = await this.extraction.extract({
      transcript: input.transcript,
      site: site.payload,
      source: input.source ?? "phone",
    });

    if (input.callId) {
      await this.ctx.store.updateCall(input.callId, {
        transcript: input.transcript,
        extracted: outcome.report,
        extractionModel: outcome.model,
        error: outcome.error,
      });
    }

    if (!outcome.report) {
      // The error already ends in a full stop, so do not add a second one.
      const reason = (outcome.error ?? "reason unknown").replace(/\.$/, "");
      const message = `Could not read a report from the call to ${site.payload.name}: ${reason}. The ranking is unchanged.`;
      await this.ctx.timeline(input.incidentId, "call_completed", message, { data: { callId: input.callId } });
      return { summary: message, reranked: false };
    }

    await this.ctx.store.setSiteReport(input.incidentId, input.assetId, outcome.report);

    const summary = ExtractionService.describe(outcome.report, site.payload.name);
    await this.ctx.timeline(input.incidentId, "report_extracted", summary, {
      data: { callId: input.callId, model: outcome.model, confidence: outcome.report.confidence },
    });

    if (outcome.report.alreadyEvacuated) {
      await this.ctx.store.updateSiteStatus(input.incidentId, input.assetId, "evacuated");
    }

    const incident = await this.getIncidentOrThrow(input.incidentId);
    const ranking = await this.rerank(incident);

    // Report what actually happened. Saying "re-ranked" when no model run was
    // available would leave the screen showing a stale order while the caller
    // believed it had been updated — the exact failure this system exists to
    // avoid, one layer down.
    if (!ranking) {
      const message = `${summary} The report is saved, but there is no model run to re-rank against yet, so the order is unchanged.`;
      await this.ctx.timeline(input.incidentId, "note", message);
      return { summary: message, reranked: false };
    }

    return { summary, reranked: true };
  }

  /**
   * Re-rank against the existing model run.
   *
   * Reuses the cached simulation rather than asking for a new one: the fire has
   * not changed, our knowledge of a building's occupancy has, and that is a
   * cheap recomputation rather than a ten-minute queue.
   */
  async rerank(incident: Incident): Promise<RankingResult | null> {
    const run = await this.ctx.store.latestSpreadRun(incident.id);
    const bands = (run?.bands as BandFeatureCollection | undefined) ?? null;
    const simulation = (run?.result as Simulation | undefined) ?? null;
    if (!bands) return null;

    const { ranking } = await this.exposure.rankIncident(incident, bands, simulation, {
      spreadRunId: run?.id ?? null,
    });
    return ranking;
  }

  async setSiteStatus(input: {
    incidentId: string;
    assetId: string;
    status: SiteStatus;
    actor: string;
    via: DecisionRecord["via"];
    note?: string;
  }): Promise<void> {
    const site = await this.getSiteOrThrow(input.incidentId, input.assetId);
    await this.ctx.store.updateSiteStatus(input.incidentId, input.assetId, input.status);
    await this.recordDecision({
      incidentId: input.incidentId,
      siteId: input.assetId,
      kind: "set_status",
      actor: input.actor,
      via: input.via,
      note: input.note ?? `Set ${site.payload.name} to ${input.status}.`,
      payload: { status: input.status },
    });
    await this.ctx.timeline(
      input.incidentId,
      "status_changed",
      `${site.payload.name} set to ${input.status.replace(/_/g, " ")} by ${input.actor}.`,
      { actor: input.actor },
    );

    const incident = await this.getIncidentOrThrow(input.incidentId);
    await this.rerank(incident);
  }

  /** Build bands from a stored run, for the map and for re-ranking. */
  static bandsOf(run: { bands?: unknown; result?: unknown } | null): BandFeatureCollection | null {
    if (!run) return null;
    if (run.bands) return run.bands as BandFeatureCollection;
    if (run.result) {
      return bandsFromSimulation(run.result as Simulation, { horizonHours: env.watch.horizonHours });
    }
    return null;
  }
}
