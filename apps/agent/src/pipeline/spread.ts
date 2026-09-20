import { randomUUID } from "node:crypto";
import {
  bandsFromSimulation,
  fallbackBands,
  spreadFrames,
  type BandFeatureCollection,
  type Incident,
  type Simulation,
} from "@arca/core";
import type { SpreadRunRecord } from "@arca/db";
import type { Context } from "../context.js";
import { env } from "../env.js";
import { describeError } from "../logger.js";

/**
 * Fire-spread runs, queued and cached.
 *
 * DeepFire allows two simulations in flight per client and a run can sit queued
 * for minutes, so this is the one place that decides whether a fresh run is
 * worth asking for. The rule is deliberately conservative: an incident that
 * already has a recent completed run gets the cached geometry, because a
 * slightly older perimeter now is worth more to a coordinator than a better one
 * in ten minutes.
 */

export interface SpreadOutcome {
  run: SpreadRunRecord;
  simulation: Simulation | null;
  bands: BandFeatureCollection;
  /** True when the bands are drawn circles rather than model output. */
  synthetic: boolean;
}

const MIN_REFRESH_MS = 30 * 60_000;

export class SpreadService {
  /** Clusters with a run in flight, so two ticks cannot double-submit. */
  private readonly inFlight = new Set<string>();

  constructor(private readonly ctx: Context) {}

  /**
   * Get spread geometry for an incident, running a new simulation only when the
   * cached one is stale or missing.
   */
  async ensure(
    incident: Incident,
    options: { force?: boolean; durationHours?: number } = {},
  ): Promise<SpreadOutcome> {
    const cached = await this.ctx.store.latestSpreadRun(incident.id);

    // A replay's geometry is recorded, so there is nothing to ask the live API
    // for — and its cluster id is not a DeepFire UUID, so asking fails anyway.
    // Forcing a refresh on one must not reach the network.
    if (incident.replay) {
      if (cached?.bands) {
        return {
          run: cached,
          simulation: (cached.result as Simulation) ?? null,
          bands: cached.bands as BandFeatureCollection,
          synthetic: cached.status !== "COMPLETED",
        };
      }
      return this.degrade(incident, cached, "This is a replay incident and its bundle carries no simulation.");
    }

    if (!options.force && cached?.status === "COMPLETED" && cached.bands) {
      const age = Date.now() - Date.parse(cached.requestedAt);
      if (age < MIN_REFRESH_MS) {
        return {
          run: cached,
          simulation: (cached.result as Simulation) ?? null,
          bands: cached.bands as BandFeatureCollection,
          synthetic: false,
        };
      }
    }

    if (this.inFlight.has(incident.clusterId)) {
      // Another tick is already waiting on this cluster. Hand back whatever we
      // have rather than queueing a second run against the two-slot budget.
      return this.degrade(incident, cached, "A simulation for this fire is already running.");
    }

    if (!this.ctx.deepfire) {
      return this.degrade(incident, cached, "DeepFire is not configured.");
    }

    this.inFlight.add(incident.clusterId);
    const runId = randomUUID();
    const requestedAt = new Date().toISOString();
    const params = {
      clusterId: incident.clusterId,
      durationHours: options.durationHours ?? env.watch.horizonHours,
      ensembleMembers: env.watch.ensembleMembers,
      lookbackHours: env.watch.lookbackHours,
    };

    try {
      await this.ctx.timeline(
        incident.id,
        "simulation_requested",
        `Requested a ${params.durationHours} h spread simulation with ${params.ensembleMembers} ensemble members.`,
        { data: params },
      );

      let created: Simulation;
      try {
        created = await this.ctx.deepfire.createSimulation(params);
      } catch (error) {
        // A historical cluster is not always accepted by cluster id. Falling
        // back to a point ignition at the centroid keeps replay incidents
        // working against the same endpoint as live ones.
        this.ctx.log.warn("Cluster ignition rejected; retrying as a point ignition.", {
          error: describeError(error),
          incidentId: incident.id,
        });
        created = await this.ctx.deepfire.createSimulation({
          latitude: incident.position[1],
          longitude: incident.position[0],
          durationHours: params.durationHours,
          ensembleMembers: params.ensembleMembers,
          lookbackHours: params.lookbackHours,
        });
      }

      const finished = await this.ctx.deepfire.waitForSimulation(created.id, {
        maxWaitMs: 10 * 60_000,
        onPoll: (simulation, elapsedMs) => {
          if (simulation.status === "QUEUED" && elapsedMs > 0 && elapsedMs % 60_000 < 11_000) {
            this.ctx.log.info("Simulation still queued", {
              incidentId: incident.id,
              elapsedSeconds: Math.round(elapsedMs / 1000),
            });
          }
        },
      });

      const bands =
        finished.status === "COMPLETED"
          ? bandsFromSimulation(finished, { horizonHours: params.durationHours })
          : null;

      const run: SpreadRunRecord = {
        id: runId,
        incidentId: incident.id,
        simulationId: finished.id,
        status: finished.status,
        params,
        result: finished,
        bands: bands ?? undefined,
        frames: finished.status === "COMPLETED" ? spreadFrames(finished, { horizonHours: params.durationHours }) : undefined,
        windSpeedMs: finished.summary?.windSpeedAvgMs ?? null,
        windDirectionDeg: finished.summary?.windDirectionAvg ?? null,
        burnedAreaM2: finished.summary?.burnedAreaM2 ?? null,
        ensembleMembers: finished.ensembleMembers ?? params.ensembleMembers,
        errorMessage: finished.errorMessage ?? null,
        requestedAt,
        completedAt: new Date().toISOString(),
      };
      await this.ctx.store.saveSpreadRun(run);

      if (finished.status === "COMPLETED" && bands && bands.features.length > 0) {
        const outer = bands.features[bands.features.length - 1];
        await this.ctx.timeline(
          incident.id,
          "simulation_completed",
          `Simulation complete: ${bands.features.length} arrival bands, outer footprint ${(
            (outer?.properties.areaM2 ?? 0) / 1_000_000
          ).toFixed(1)} km².`,
          { data: { simulationId: finished.id, members: run.ensembleMembers } },
        );
        return { run, simulation: finished, bands, synthetic: false };
      }

      const reason =
        finished.status === "NO_SPREAD"
          ? "The model ran but the fire did not grow meaningfully."
          : (finished.errorMessage ?? `Simulation ${finished.status.toLowerCase()}.`);
      await this.ctx.timeline(incident.id, "simulation_failed", reason, {
        data: { simulationId: finished.id, status: finished.status },
      });
      return this.degrade(incident, run, reason);
    } catch (error) {
      const message = describeError(error);
      const run: SpreadRunRecord = {
        id: runId,
        incidentId: incident.id,
        simulationId: null,
        status: "FAILED",
        params,
        errorMessage: message,
        requestedAt,
        completedAt: new Date().toISOString(),
      };
      await this.ctx.store.saveSpreadRun(run).catch(() => undefined);
      await this.ctx.timeline(incident.id, "simulation_failed", `Simulation could not be run: ${message}`);
      return this.degrade(incident, run, message);
    } finally {
      this.inFlight.delete(incident.clusterId);
    }
  }

  /**
   * Fall back to the best geometry available, and only then to drawn rings.
   *
   * The store is re-queried rather than trusting the record this was handed:
   * the caller passes the run that just failed, and an earlier version returned
   * that, so a refresh that failed replaced a good ten-member ensemble with
   * drawn circles. A coordinator watching the screen saw "9 of 10 runs" become
   * "1/1" and the order change, because a network call had failed.
   *
   * `latestSpreadRun` already prefers a completed run over a newer failure,
   * which is exactly the question being asked here.
   *
   * Drawn rings remain the last resort, and they are obviously a substitute:
   * they carry a zero probability floor, the flag every consumer reads to label
   * them a circle drawn around a fire rather than a prediction.
   */
  private async degrade(
    incident: Incident,
    _failed: SpreadRunRecord | null,
    reason: string,
  ): Promise<SpreadOutcome> {
    const best = await this.ctx.store.latestSpreadRun(incident.id).catch(() => null);

    if (best?.status === "COMPLETED" && best.bands) {
      await this.ctx.timeline(
        incident.id,
        "note",
        `Keeping the previous model run: ${reason}`,
      );
      return {
        run: best,
        simulation: (best.result as Simulation) ?? null,
        bands: best.bands as BandFeatureCollection,
        synthetic: false,
      };
    }

    const bands = fallbackBands(incident.position, { horizonHours: env.watch.horizonHours });
    const run: SpreadRunRecord = best ?? {
      id: randomUUID(),
      incidentId: incident.id,
      simulationId: null,
      status: "FALLBACK",
      errorMessage: reason,
      requestedAt: new Date().toISOString(),
    };
    return { run: { ...run, bands }, simulation: null, bands, synthetic: true };
  }
}
