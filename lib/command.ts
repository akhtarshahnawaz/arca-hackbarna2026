import evacConfig from "../config/evac-times.json";
import { applyReportedConfirmations } from "./confirmations";
import { demoPolygons, demoSites } from "./demo-data";
import { checkHotspots, corroborateSites, sortByCorroboration } from "./crosscheck";
import { fetchDeepfireHotspots, fetchStaticHeatSources } from "./deepfire";
import { fetchEffisDetections, fetchFirmsDetections } from "./fire-feeds";
import { ensureArcaSchema, listLatestConfirmations, listProtectiveActions, listRememberedSimulations } from "./db";
import { rankSites } from "./ranking";
import { fetchRegistryFarms } from "./registry";
import { applyConfiguredShelters, loadShelterConfig, shelterSourceDetail } from "./shelters";
import type { CommandState, EvacConfig, SiteInput } from "./types";
import { contactPolicyPublic, listVoiceSummaries, processDueVoiceRetries } from "./voice-calls";
import { getVoiceStatus } from "./voice-status";
import { loadContactPolicy } from "./contact-policy";
import { loadRankingPolicy } from "./ranking-policy";
import type { ProtectiveAction } from "./protective-action";

const config = evacConfig as EvacConfig;

export async function getCommandState(): Promise<CommandState> {
  const generatedAt = new Date().toISOString();
  const demoClusterId = process.env.DEMO_CLUSTER_ID?.trim() || "";
  const voice = getVoiceStatus();
  const shelterConfig = loadShelterConfig();
  const contactPolicy = loadContactPolicy();
  const banners: string[] = [
    "Hour polygons are DEMO — an ensemble built for the Bages / Font-rubí briefing, not a live Deepfire spread.",
    contactPolicy.dashboardLabel,
    "Formula ranks automatically. LLM explains. One Approve covers the Voice retry plan (max 3).",
  ];
  if (voice.banner) banners.push(voice.banner);
  // Degraded inputs stay out of `banners`. The console collapses the notes, so a
  // feed failure mixed in there reads as one more line of demo copy.
  const alerts: string[] = [];
  await processDueVoiceRetries().catch(() => 0);

  try {
    await ensureArcaSchema();
  } catch (error) {
    const message = error instanceof Error ? error.message : "db error";
    alerts.push(`ARCA LibSQL could not open (${message}). Rankings still run in memory.`);
  }

  const [deepfire, registry, heat, firms, effis] = await Promise.all([
    fetchDeepfireHotspots(),
    fetchRegistryFarms(),
    fetchStaticHeatSources(),
    fetchFirmsDetections(),
    fetchEffisDetections(),
  ]);

  // Cross-check: a hotspot two independent feeds agree on outranks the clock.
  const detections = [...firms.detections, ...effis.detections];
  const hotspots = checkHotspots(deepfire.hotspots, detections, heat.heatSources);
  const agreed = hotspots.filter((spot) => spot.confirmedBy.length > 1 && !spot.staticHeat);
  const onChimney = hotspots.filter((spot) => spot.staticHeat !== null);

  const seeded = demoSites();
  const extra = registry.sites.filter(
    (farm) => !seeded.some((site) => codesOverlap(site, farm)),
  );
  let confirmations: Awaited<ReturnType<typeof listLatestConfirmations>> = [];
  try {
    confirmations = await listLatestConfirmations();
  } catch {
    // Schema already reported if the file could not open.
  }
  const sites: SiteInput[] = applyConfiguredShelters(
    applyReportedConfirmations([...seeded, ...extra], confirmations),
    shelterConfig,
  );
  const polygons = demoPolygons();
  const { ranked, watch } = rankSites(sites, polygons, {
    ensembleMembers: config.ensembleMembers,
    horizonHours: config.horizonHours,
  });

  let chosen = new Map<string, ProtectiveAction>();
  try {
    chosen = await listProtectiveActions();
  } catch {
    // Schema already reported if the file could not open.
  }
  const withChoice = <T extends { id: string; code: string; phone?: string | null }>(rows: T[]) =>
    rows.map((site) => {
      const { phone, ...rest } = site;
      return {
        ...rest,
        protectiveAction: chosen.get(site.code) ?? chosen.get(site.id) ?? null,
        phoneOnFile: Boolean(phone),
      };
    });

  if (demoClusterId) {
    banners.push(
      `Demo cluster ${demoClusterId} is a Catalan wildfire pick, not Tarragona industry. Map rings stay DEMO.`,
    );
    try {
      const remembered = await listRememberedSimulations(demoClusterId);
      const simId = remembered[0]?.deepfire_simulation_id;
      if (typeof simId === "string" && simId) {
        banners.push(
          `Remembered Deepfire simulation ${simId}. Crash recovery uses that id — no new 10×6 ensemble.`,
        );
      }
    } catch {
      // Schema already reported if the file could not open.
    }
  }

  if (!deepfire.ok) alerts.push(deepfire.detail);
  if (!registry.ok) alerts.push(registry.detail);
  if (!heat.ok) alerts.push(heat.detail);
  if (!firms.ok) alerts.push(firms.detail);
  if (!effis.ok && process.env.EFFIS_GEOJSON_URL) alerts.push(effis.detail);
  if (agreed.length > 0) {
    banners.push(
      `Cross-check: ${agreed.length} hotspot${agreed.length === 1 ? "" : "s"} seen by two feeds. Sites near one are pinned to the top of the list.`,
    );
  }
  if (onChimney.length > 0) {
    banners.push(
      `${onChimney.length} hotspot${onChimney.length === 1 ? " sits" : "s sit"} on a known static heat source. Drawn, never promoted.`,
    );
  }

  return {
    generatedAt,
    fire: {
      id: demoClusterId || "demo-bages-2026",
      name: "INC-DEMO Bages",
      municipality: "Navàs / Sant Fruitós de Bages",
      ignition: [1.82, 41.72],
      mode: "demo",
      ensembleMembers: config.ensembleMembers,
      horizonHours: config.horizonHours,
      polygons,
      displayMember: 4,
    },
    sites: rerank(sortByCorroboration(corroborateSites(withChoice(ranked), hotspots))),
    watch: sortByCorroboration(corroborateSites(withChoice(watch), hotspots)),
    watchIfFewerThanRuns: loadRankingPolicy().watchIfFewerThanRuns,
    sources: [
      {
        id: "deepfire",
        label: "Deepfire hotspots",
        kind: deepfire.ok ? "live" : "maybe_old",
        detail: deepfire.detail,
        fetchedAt: deepfire.fetchedAt,
        ok: deepfire.ok,
      },
      {
        id: "firms",
        label: "NASA FIRMS cross-check",
        kind: firms.ok ? "live" : "maybe_old",
        detail: firms.detail,
        fetchedAt: firms.fetchedAt,
        ok: firms.ok,
      },
      {
        id: "static-heat",
        label: "Static heat sources",
        kind: heat.ok ? "maybe_old" : "demo",
        detail: heat.ok
          ? `${heat.detail} Mask is a 2016 survey, not a live layer.`
          : heat.detail,
        fetchedAt: heat.fetchedAt,
        ok: heat.ok,
      },
      {
        id: "spread",
        label: "Hour polygons",
        kind: "demo",
        detail: demoClusterId
          ? `DEMO rings. Live cluster ${demoClusterId.slice(0, 8)} is labelled; spread polygons are not attached.`
          : "10-member demo ensemble. Live Deepfire spread is not attached to this briefing.",
        fetchedAt: generatedAt,
        ok: true,
      },
      {
        id: "registry",
        label: "Livestock registry",
        kind: "maybe_old",
        detail: registry.ok
          ? `${registry.detail} Capacity is a register, not a headcount.`
          : registry.detail,
        fetchedAt: registry.fetchedAt,
        ok: registry.ok,
      },
      {
        id: "osm",
        label: "OSM / care homes",
        kind: "maybe_old",
        detail: "Care home seed only. OSM protectoras are not the pet-evac list.",
        fetchedAt: null,
        ok: true,
      },
      {
        id: "shelters",
        label: "Pet shelters",
        kind: "demo",
        detail: shelterSourceDetail(shelterConfig),
        fetchedAt: generatedAt,
        ok: true,
      },
      {
        id: "residents",
        label: "Residents",
        kind: "live",
        detail:
          "Opt-in household codes only. Telegram alerts wait for coordinator Approve. Phones stay on the server from env; they are not shown on this briefing.",
        fetchedAt: generatedAt,
        ok: true,
      },
    ],
    banners,
    alerts,
    hotspots,
    heatSources: heat.heatSources,
    detections,
    shelters: shelterConfig.shelters,
    shelterLabel: shelterConfig.label,
    voice,
    voiceCalls: await listVoiceSummaries(),
    contactPolicy: contactPolicyPublic(),
  };
}

/** Renumbers a list after the cross-check re-sort so rank 1 is the top row again. */
function rerank<T extends { rank: number }>(rows: T[]): T[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function codesOverlap(a: SiteInput, b: SiteInput) {
  return a.code === b.code || a.id === b.id;
}
