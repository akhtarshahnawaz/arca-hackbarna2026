import { loadOfficialFacilities } from "./official-facilities";
import evacConfig from "../config/evac-times.json";
import { applyReportedConfirmations } from "./confirmations";
import { demoPolygons, demoSites } from "./demo-data";
import {
  checkHotspots,
  corroborateSites,
  isCorroborated,
  isOnStaticHeat,
  siteRadiusKm,
  sortByCorroboration,
} from "./crosscheck";
import { haversineKm } from "./geo";
import { fetchDeepfireHotspots, fetchStaticHeatSources } from "./deepfire";
import { fetchEffisDetections, fetchFirmsDetections } from "./fire-feeds";
import { ensureArcaSchema, listLatestConfirmations, listProtectiveActions, listRememberedSimulations } from "./db";
import { rankSites } from "./ranking";
import { fetchRegistryFarms } from "./registry";
import { applyConfiguredShelters, loadShelterConfig, shelterSourceDetail } from "./shelters";
import type { CheckedHotspot, CommandState, EvacConfig, FeedDetection, SiteInput } from "./types";
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

  const [deepfire, registry, heat, firms, effis, official] = await Promise.all([
    fetchDeepfireHotspots(),
    fetchRegistryFarms(),
    fetchStaticHeatSources(),
    fetchFirmsDetections(),
    fetchEffisDetections(),
    loadOfficialFacilities(),
  ]);

  // Cross-check: a hotspot two independent feeds agree on outranks the clock.
  // The mask has to be complete before any hotspot is promoted — see
  // `checkHotspots`. `isCorroborated` is the one predicate; nothing here
  // re-derives it.
  const detections = [...firms.detections, ...effis.detections];
  const maskReady = heat.ok && heat.complete;
  const hotspots = checkHotspots(deepfire.hotspots, detections, heat.heatSources, maskReady);
  const agreed = hotspots.filter(isCorroborated);
  const onChimney = hotspots.filter(isOnStaticHeat);

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
    applyReportedConfirmations([...seeded, ...extra, ...official.sites], confirmations),
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
  // One cause, one alert. Missing credentials fail the hotspot query and the
  // heat query alike, and two near-identical lines in the degraded-input list
  // read as two separate outages.
  if (!heat.ok && !(heat.failure === "credentials" && deepfire.failure === "credentials")) {
    alerts.push(heat.detail);
  } else if (!heat.ok) {
    alerts.push("Chimney mask is off with the same missing credentials. Hotspots are not discounted for static heat.");
  }
  if (heat.ok && !heat.complete) alerts.push(heat.detail);
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
  if (!official.status.ok) alerts.push(official.status.detail);

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
    // `rank` is the row number after the cross-check re-sort; `timeRank` keeps
    // the clock order underneath it so broadcast copy can still find the site
    // that is soonest out of time. See `mostUrgent`.
    sites: rerank(sortByCorroboration(corroborateSites(keepTimeRank(withChoice(ranked)), hotspots))),
    watch: sortByCorroboration(corroborateSites(keepTimeRank(withChoice(watch)), hotspots)),
    watchIfFewerThanRuns: loadRankingPolicy().watchIfFewerThanRuns,
    sources: [
      official.status,
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
        id: "effis",
        label: "EU Copernicus cross-check",
        // EFFIS detections change which site ranks first, so the freshness
        // strip — the one surface that explains where a number came from —
        // has to carry a row for them.
        kind: effis.ok ? "live" : "maybe_old",
        detail: effis.detail,
        fetchedAt: effis.fetchedAt,
        ok: effis.ok,
      },
      {
        id: "static-heat",
        label: "Static heat sources",
        // A failed mask is not a demo mask. "Demo" implies stand-in chimneys
        // are drawn; nothing is drawn at all.
        kind: "maybe_old",
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
    detections: detectionsNearby(detections, hotspots, [...ranked, ...watch]),
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

/**
 * Stamps the clock order — least spare time first — before the cross-check
 * re-sort renumbers the list. Watch rows carry `rank: 0`, so they are numbered
 * by position here rather than left all equal.
 */
function keepTimeRank<T extends { rank: number }>(rows: T[]): (T & { timeRank: number })[] {
  return rows.map((row, index) => ({ ...row, timeRank: row.rank || index + 1 }));
}

/**
 * Cross-feed detections worth drawing: the ones near a hotspot or a listed
 * site. The Catalonia bbox returns every FIRMS pixel in the region, and in fire
 * season shipping all of them put thousands of markers on the demo laptop.
 */
function detectionsNearby(
  detections: FeedDetection[],
  hotspots: CheckedHotspot[],
  sites: { lat: number; lon: number }[],
  cap = 500,
): FeedDetection[] {
  const radius = siteRadiusKm();
  const anchors = [...hotspots, ...sites];
  if (anchors.length === 0) return detections.slice(0, cap);
  return detections
    .filter((detection) =>
      anchors.some((anchor) => haversineKm(detection, anchor) <= radius),
    )
    .slice(0, cap);
}

function codesOverlap(a: SiteInput, b: SiteInput) {
  return a.code === b.code || a.id === b.id;
}
