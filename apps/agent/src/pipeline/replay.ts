import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  StaticSourceIndex,
  bandsFromSimulation,
  cleanHotspots,
  classifySensor,
  confirmationScore,
  spreadFrames,
  type ExposureReport,
  type Hotspot,
  type Incident,
  type ScenarioSummary,
  type Simulation,
  type StaticHeatSource,
} from "@arca/core";
import type { Context } from "../context.js";
import { env } from "../env.js";
import { describeError } from "../logger.js";

/**
 * Replay of a recorded fire.
 *
 * A live demo of a wildfire system has an obvious problem: there may be no
 * wildfire. Replay solves it honestly — a real Catalan fire, recorded from the
 * real APIs, played back through the identical cleaning, banding and ranking
 * code. Nothing is faked; the only difference is where the bytes come from, and
 * every replay incident is flagged so it can never be mistaken for live.
 *
 * It is also how the pipeline is regression-tested: same bundle in, same
 * ranking out.
 */

export interface ReplayBundle {
  name: string;
  /** Human title for the picker. Falls back to a tidied file name. */
  label?: string;
  /** Where it is, in words. */
  place?: string;
  /** One sentence on what this scenario is for. */
  blurb?: string;
  /** True for generated bundles. Surfaced in the UI, never hidden. */
  synthetic?: boolean;
  note?: string;
  /** DeepFire fire id, for provenance. */
  fireId?: string;
  clusterId: string;
  position: [number, number];
  firstObserved: string;
  lastObserved: string;
  hotspots: Hotspot[];
  staticSources?: StaticHeatSource[];
  simulation?: Simulation;
  exposure?: ExposureReport;
  hasPerimeter?: boolean;
}

export class ReplayService {
  constructor(
    private readonly ctx: Context,
    private readonly fixturesDir: string,
  ) {}

  async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.fixturesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }

  /**
   * The scenarios, described well enough to choose between them.
   *
   * Reads each bundle rather than listing file names, because a picker that
   * says "demo bages synthetic" asks the operator to guess. A bundle that fails
   * to parse is skipped and logged: one bad file must not empty the list.
   */
  async catalogue(): Promise<ScenarioSummary[]> {
    const names = await this.list();
    const incidents = await this.ctx.store.listIncidents({}).catch(() => [] as Incident[]);
    const byCluster = new Map(incidents.map((incident) => [incident.clusterId, incident]));

    const entries = await Promise.all(
      names.map(async (name) => {
        const bundle = await this.load(name);
        if (!bundle) return null;
        const incident = byCluster.get(bundle.clusterId) ?? null;
        return {
          name,
          label: bundle.label ?? titleFrom(name),
          place: bundle.place ?? "Catalonia",
          blurb: bundle.blurb ?? bundle.note ?? "Recorded detections, real pipeline.",
          synthetic: bundle.synthetic !== false,
          position: bundle.position,
          firstObserved: bundle.firstObserved,
          lastObserved: bundle.lastObserved,
          detections: bundle.hotspots.length,
          assets: bundle.exposure?.assets?.length ?? null,
          peopleEstimate: bundle.exposure?.summary?.people_estimate ?? null,
          incidentId: incident?.id ?? null,
        } satisfies ScenarioSummary;
      }),
    );

    return entries
      .filter((entry): entry is ScenarioSummary => entry !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async load(name: string): Promise<ReplayBundle | null> {
    // Bundle names come from the API, so they must not be able to walk out of
    // the fixtures directory.
    if (!/^[a-z0-9-]+$/i.test(name)) return null;
    try {
      const raw = await readFile(join(this.fixturesDir, `${name}.json`), "utf8");
      return JSON.parse(raw) as ReplayBundle;
    } catch (error) {
      this.ctx.log.warn("Replay bundle unavailable", { name, error: describeError(error) });
      return null;
    }
  }

  /**
   * Open a replay incident, optionally as it stood at a past moment.
   *
   * `asOf` is what makes the timeline scrubber real rather than cosmetic: the
   * detections are filtered to those observed by that time and the confirmation
   * score is recomputed, so scrubbing back shows the incident as ARCA would
   * genuinely have seen it — often below the confirmation bar.
   */
  async start(name: string, options: { asOf?: string } = {}): Promise<Incident | null> {
    const bundle = await this.load(name);
    if (!bundle) return null;

    const asOf = options.asOf ? new Date(options.asOf) : new Date(bundle.lastObserved);
    const hotspots = bundle.hotspots
      .map((hotspot) => ({
        ...hotspot,
        sensorClass: hotspot.sensorClass ?? classifySensor(hotspot.source),
      }))
      .filter((hotspot) => Date.parse(hotspot.observedAt) <= asOf.getTime());

    const staticIndex = bundle.staticSources?.length
      ? new StaticSourceIndex(bundle.staticSources)
      : null;

    const cleaned = cleanHotspots(hotspots, {
      staticIndex,
      now: asOf,
      maskComplete: Boolean(staticIndex),
    });
    const confirmation = confirmationScore(cleaned, { hasPerimeter: bundle.hasPerimeter ?? false });

    const existing = await this.ctx.store.getIncidentByCluster(bundle.clusterId);
    const incident: Incident = {
      id: existing?.id ?? randomUUID(),
      clusterId: bundle.clusterId,
      name: bundle.label ?? titleFrom(bundle.name),
      status: confirmation.classification === "CONFIRMED" ? "confirmed" : "candidate",
      replay: true,
      position: bundle.position,
      firstObserved: bundle.firstObserved,
      lastObserved: asOf.toISOString(),
      confirmation,
      weather: existing?.weather ?? null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.ctx.store.upsertIncident(incident);
    await this.ctx.store.saveHotspots(incident.id, cleaned.hotspots);

    await this.ctx.timeline(
      incident.id,
      "detected",
      `Replay of ${bundle.name} as of ${asOf.toISOString().slice(0, 16).replace("T", " ")}Z: ${cleaned.usable.length} usable detections, ${cleaned.counts.static_source} masked, score ${confirmation.score}/100.`,
      { actor: "replay", data: { counts: cleaned.counts, asOf: asOf.toISOString() } },
    );

    // The recorded model run and exposure go in as if they had just arrived, so
    // everything downstream is the live code path rather than a special case.
    if (bundle.simulation) {
      const bands = bandsFromSimulation(bundle.simulation, { horizonHours: env.watch.horizonHours });
      await this.ctx.store.saveSpreadRun({
        id: randomUUID(),
        incidentId: incident.id,
        simulationId: bundle.simulation.id,
        status: bundle.simulation.status,
        params: { replay: true },
        result: bundle.simulation,
        bands,
        frames: spreadFrames(bundle.simulation, { horizonHours: env.watch.horizonHours }),
        windSpeedMs: bundle.simulation.summary?.windSpeedAvgMs ?? null,
        windDirectionDeg: bundle.simulation.summary?.windDirectionAvg ?? null,
        burnedAreaM2: bundle.simulation.summary?.burnedAreaM2 ?? null,
        ensembleMembers: bundle.simulation.ensembleMembers ?? null,
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    }

    return incident;
  }

  /**
   * Resolve a bundle by file name or by the label shown on screen.
   *
   * Incidents are named for the operator, not for the filesystem, so the only
   * handle the exposure fallback has on a replay incident is its label. This is
   * where the two are reconciled — file name first, because that is exact.
   */
  async resolveName(nameOrLabel: string): Promise<string | null> {
    const names = await this.list();
    if (names.includes(nameOrLabel)) return nameOrLabel;
    const wanted = nameOrLabel.trim().toLowerCase();
    for (const name of names) {
      const bundle = await this.load(name);
      const label = (bundle?.label ?? titleFrom(name)).trim().toLowerCase();
      if (label === wanted) return name;
    }
    return null;
  }

  /** The recorded exposure, used as the Talaia failsafe's last rung. */
  async exposureFor(nameOrLabel: string): Promise<ExposureReport | null> {
    const name = await this.resolveName(nameOrLabel);
    if (!name) return null;
    const bundle = await this.load(name);
    return bundle?.exposure ?? null;
  }
}

/** "demo-bages-synthetic" reads badly on a wall display. */
function titleFrom(name: string): string {
  return name
    .replace(/^demo-/, "")
    .replace(/-synthetic$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
