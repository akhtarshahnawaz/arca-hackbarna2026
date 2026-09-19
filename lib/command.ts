import evacConfig from "@/config/evac-times.json";
import { applyReportedConfirmations } from "@/lib/confirmations";
import { demoPolygons, demoSites } from "@/lib/demo-data";
import { fetchDeepfireHotspots } from "@/lib/deepfire";
import { ensureArcaSchema, listLatestConfirmations, listRememberedSimulations } from "@/lib/db";
import { rankSites } from "@/lib/ranking";
import { fetchRegistryFarms } from "@/lib/registry";
import type { CommandState, EvacConfig, SiteInput } from "@/lib/types";

const config = evacConfig as EvacConfig;

export async function getCommandState(): Promise<CommandState> {
  const generatedAt = new Date().toISOString();
  const demoClusterId = process.env.DEMO_CLUSTER_ID?.trim() || "";
  const banners: string[] = [
    "Hour polygons are DEMO — an ensemble built for the Bages / Font-rubí briefing, not a live Deepfire spread.",
    "ARCA does not place calls. The coordinator phones the site, then logs counts as reported — not verified.",
  ];

  try {
    await ensureArcaSchema();
  } catch (error) {
    const message = error instanceof Error ? error.message : "db error";
    banners.push(`ARCA LibSQL could not open (${message}). Rankings still run in memory.`);
  }

  const [deepfire, registry] = await Promise.all([
    fetchDeepfireHotspots(),
    fetchRegistryFarms(),
  ]);

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
  const sites: SiteInput[] = applyReportedConfirmations([...seeded, ...extra], confirmations);
  const polygons = demoPolygons();
  const { ranked, watch } = rankSites(sites, polygons, {
    ensembleMembers: config.ensembleMembers,
    horizonHours: config.horizonHours,
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

  if (!deepfire.ok) banners.push(deepfire.detail);
  if (!registry.ok) banners.push(registry.detail);

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
    sites: ranked,
    watch,
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
        label: "OSM / facilities",
        kind: "maybe_old",
        detail: "Care home and shelter hints are curated for the demo. Overpass wiring comes later.",
        fetchedAt: null,
        ok: true,
      },
      {
        id: "residents",
        label: "Residents",
        kind: "live",
        detail: "Opt-in household codes only. Telegram alerts wait for coordinator Approve. No names or phones in this briefing.",
        fetchedAt: generatedAt,
        ok: true,
      },
    ],
    banners,
    hotspots: deepfire.hotspots,
  };
}

function codesOverlap(a: SiteInput, b: SiteInput) {
  return a.code === b.code || a.id === b.id;
}
