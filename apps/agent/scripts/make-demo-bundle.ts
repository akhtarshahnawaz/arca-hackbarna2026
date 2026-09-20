/**
 * Build the synthetic demo replay bundle.
 *
 * ARCA ships one replay bundle that needs no credentials, so the system can be
 * run and judged by anyone who clones it. It is generated, and it says so in
 * every field that matters: the name, a `synthetic` flag, and a note carried
 * into the incident. Nothing here is presented as recorded satellite data.
 *
 * The geography is real — Sant Fruitós de Bages, north-east of Manresa — and
 * the shape of the data matches the real APIs exactly, because the whole point
 * is that the pipeline cannot tell the difference. For a bundle recorded from
 * the live DeepFire API, use `record-fixture.ts` instead.
 *
 *   pnpm --filter @arca/agent exec tsx scripts/make-demo-bundle.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "..", "..", "fixtures", "replay");

const IGNITION: [number, number] = [1.876, 41.766];
const START = Date.parse("2026-09-19T11:40:00.000Z");

type Position = [number, number];

/** Metres to degrees at this latitude, so offsets are round on the ground. */
function offset(from: Position, eastM: number, northM: number): Position {
  const lat = from[1] + northM / 110_540;
  const lon = from[0] + eastM / (111_320 * Math.cos((from[1] * Math.PI) / 180));
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

function ring(centre: Position, radiusM: number, stretchEast = 1, steps = 48): Position[] {
  const points: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    points.push(
      offset(centre, Math.cos(theta) * radiusM * stretchEast, Math.sin(theta) * radiusM),
    );
  }
  points.push(points[0]!);
  return points;
}

/**
 * Detections, growing with the fire.
 *
 * Deliberately includes three things a clean feed would not: a quarry that two
 * satellites keep reporting, a lone low-confidence pixel, and a geostationary
 * re-report of the same coarse pixel. Those are what the cleaning rules exist
 * for, and a demo that omits them would not show the product working.
 */
function hotspots() {
  const rows: Array<Record<string, unknown>> = [];
  const push = (
    minutes: number,
    position: Position,
    source: string,
    confidence: string,
    frp: number,
    clusterId = "demo-cluster-bages",
  ) => {
    rows.push({
      id: `demo-h${rows.length.toString().padStart(3, "0")}`,
      clusterId,
      position,
      observedAt: new Date(START + minutes * 60_000).toISOString(),
      source,
      confidence,
      fireRadiativePowerMw: Number(frp.toFixed(1)),
      country: "ES",
      active: true,
    });
  };

  // First pass: one polar satellite sees a small, hot front.
  // Spaced a full VIIRS pixel apart: neighbouring ground, not the same pixel
  // reported twice, so the duplicate rule correctly leaves them alone.
  for (let i = 0; i < 6; i++) {
    push(0, offset(IGNITION, -560 + i * 400, -420 + i * 300), "VIIRS_NOAA20_NRT", "HIGH", 42 + i * 9);
  }
  // Geostationary confirms twenty minutes later: two families agree.
  for (let i = 0; i < 3; i++) {
    push(22, offset(IGNITION, -180 + i * 340, 40 + i * 120), "MTG_I1", "MEDIUM", 60 + i * 14);
  }
  // A re-report of the same coarse pixel. The duplicate rule should collapse it.
  push(24, offset(IGNITION, -175, 45), "MTG_I1", "MEDIUM", 58);

  // Second pass: the front has run north-east and intensified.
  for (let i = 0; i < 14; i++) {
    push(
      54,
      offset(IGNITION, -700 + i * 420, -520 + i * 330),
      i % 3 === 0 ? "VIIRS_SNPP_NRT" : "VIIRS_NOAA20_NRT",
      i % 5 === 0 ? "MEDIUM" : "HIGH",
      70 + i * 11,
    );
  }
  // Landsat catches the head at 30 m.
  for (let i = 0; i < 4; i++) {
    push(61, offset(IGNITION, 1600 + i * 120, 1300 + i * 110), "LANDSAT_NRT", "HIGH", 180 + i * 30);
  }

  // A quarry 9 km south-west, reported by two satellites all day. Two sensors
  // agreeing about a quarry is still a quarry.
  push(8, [1.782, 41.703], "MODIS_NRT", "MEDIUM", 21);
  push(46, [1.7823, 41.7032], "VIIRS_SNPP_NRT", "MEDIUM", 24);

  // A single low-confidence pixel 7 km out, in its own cluster. With nothing
  // to corroborate it, the confidence rule should exclude it — which is the
  // difference between an early-warning system and a false-alarm generator.
  push(37, offset(IGNITION, 5200, -4800), "MODIS_NRT", "LOW", 9, "demo-cluster-stray");

  return rows;
}

/**
 * A ten-member ensemble, in DeepFire's shape: per hour, nested probability
 * contours, wind-stretched to the north-east. Higher probability means a
 * tighter footprint, which is what an ensemble actually produces.
 */
function simulation() {
  const features: Array<Record<string, unknown>> = [];
  const contours: Array<[number, number]> = [
    [0.9, 0.42],
    [0.7, 0.58],
    [0.5, 0.74],
    [0.3, 0.9],
    [0.2, 1.0],
  ];

  for (let hour = 1; hour <= 6; hour++) {
    // Roughly 1.1 km/h along the wind, slower across it.
    const reach = 1_150 * hour;
    const drift = offset(IGNITION, reach * 0.45, reach * 0.42);
    for (const [probability, scale] of contours) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring(drift, reach * scale, 1.35)] },
        properties: {
          hour,
          elapsed_seconds: hour * 3600,
          burn_probability: probability,
        },
      });
    }
  }

  return {
    id: "demo-sim-bages",
    status: "COMPLETED",
    clusterId: "demo-cluster-bages",
    model: "elmfire",
    durationHours: 6,
    ensembleMembers: 10,
    sources: ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "LANDSAT_NRT"],
    lookbackHours: 12,
    locationName: "Sant Fruitós de Bages, Catalunya",
    ignitionPointCount: 24,
    ignition: {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: IGNITION }, properties: {} }],
    },
    summary: {
      burnedAreaM2: 21_400_000,
      edgeReached: false,
      windSpeedAvgMs: 8.4,
      windDirectionAvg: 227,
    },
    result: { type: "FeatureCollection", features },
  };
}

/**
 * A stand-in exposure report.
 *
 * Only used when Talaia is unreachable — it is the last rung of the failsafe
 * ladder. With a TALAIA_API_KEY set, the replay queries the live service like
 * any other incident, which is the path worth demonstrating.
 */
function exposure() {
  const asset = (
    id: string,
    name: string,
    category: string,
    subcategory: string,
    position: Position,
    people: number,
    basis: string,
    bandMinutes: number,
    extras: Record<string, unknown> = {},
  ) => ({
    id,
    category,
    subcategory,
    name,
    geometry: { type: "Point", coordinates: position },
    capacity: { places: people, people, basis, confidence: 0.7 },
    contacts: { phone: ["+34938000000"], email: [], operator: null },
    valuation: {
      total_eur: people * 45_000 + 400_000,
      method: "default_footprint",
      confidence: 0.3,
      assumptions: ["class-default footprint", "regional cost index 1.0"],
    },
    vulnerability: 70,
    criticality: 90,
    hazardous: false,
    response_asset: false,
    human_bearing: true,
    exposure: {
      band: `t+${Math.round(bandMinutes / 60)}h`,
      band_minutes: bandMinutes,
      inside_aoi: true,
      priority_score: 60,
    },
    provenance: [{ source_id: "demo.synthetic", source_ref: id }],
    ...extras,
  });

  const assets = [
    asset("demo-care-1", "Residència Sant Andreu", "social_care", "care_home",
      offset(IGNITION, 1500, 1350), 64, "registered places", 120),
    asset("demo-school-1", "Escola Monsenyor Gibert", "education", "primary_school",
      offset(IGNITION, 2600, 2100), 312, "enrolment", 180),
    asset("demo-farm-1", "Mas del Grau", "livestock", "livestock_farm",
      offset(IGNITION, 900, 1100), 0, "REGA capacity", 120, {
        capacity: { places: 340, people: 2, basis: "REGA capacity", confidence: 0.6, livestock_units: 340,
          species: [{ species: "sheep", count: 300 }, { species: "goat", count: 40 }] },
        criticality: 55, human_bearing: true,
      }),
    // Further out and off the wind axis, so these sit in the lower-probability
    // contours and the ranked list shows a real spread of certainty rather than
    // one number repeated down the column.
    asset("demo-camp-1", "Càmping El Solell", "tourism", "campsite",
      offset(IGNITION, 4200, 1600), 180, "pitches × 3", 240),
    asset("demo-cap-1", "CAP Sant Fruitós", "healthcare", "primary_care",
      offset(IGNITION, 5600, 4600), 40, "registered", 300, { response_asset: true, criticality: 95 }),
    // On the fringe: reached in only some runs, so it demonstrates the tiers.
    // A ranked list where every row says 9/10 teaches nothing about certainty.
    asset("demo-school-2", "Institut Gallifa", "education", "secondary_school",
      offset(IGNITION, 8600, 6400), 540, "enrolment", 360),
    asset("demo-care-2", "Residència El Roure", "social_care", "care_home",
      offset(IGNITION, 11500, 8200), 48, "registered places", 360),
    asset("demo-fuel-1", "Estació de servei C-16", "industry", "fuel_station",
      offset(IGNITION, 1100, 900), 3, "staff", 60, {
        hazardous: true, human_bearing: false, criticality: 60, vulnerability: 90,
      }),
    asset("demo-nursery-1", "Llar d'infants Els Pinetons", "education", "nursery",
      offset(IGNITION, 2000, 1700), 58, "places", 180, { criticality: 95 }),
  ];

  return {
    summary: {
      asset_count: assets.length,
      people_estimate: assets.reduce((sum, a) => sum + (a.capacity.people ?? 0), 0),
      population_resident: 4820,
      total_value_eur: assets.reduce((sum, a) => sum + a.valuation.total_eur, 0),
      critical_assets: assets.filter((a) => (a.criticality ?? 0) >= 90).length,
      hazardous_assets: assets.filter((a) => a.hazardous).length,
      livestock_units: 340,
      coverage_regime: "synthetic demo bundle — not Talaia output",
    },
    bands: [],
    assets,
    warnings: [
      "This exposure is a synthetic demo fixture, not a Talaia response. Set TALAIA_API_KEY to query real registries.",
    ],
    population: { total: 4820, cell_count: 6, peak_density_per_km2: 1900, cells: [] },
  };
}

async function main(): Promise<void> {
  const bundle = {
    name: "demo-bages-synthetic",
    synthetic: true,
    note:
      "Generated demo data, not recorded satellite output. Real geography near Sant Fruitós de Bages; detections, model run and exposure are constructed to exercise the cleaning, banding and ranking rules. Use scripts/record-fixture.ts to capture a real fire from the DeepFire API.",
    clusterId: "demo-cluster-bages",
    position: IGNITION,
    firstObserved: new Date(START).toISOString(),
    lastObserved: new Date(START + 65 * 60_000).toISOString(),
    hasPerimeter: true,
    staticSources: [
      {
        id: "demo-static-quarry",
        type: "Thermal anomaly",
        remarks: "Pedrera de Sant Salvador (demo quarry)",
        geometry: { type: "Polygon", coordinates: [ring([1.782, 41.703], 320)] },
      },
    ],
    hotspots: hotspots(),
    simulation: simulation(),
    exposure: exposure(),
  };

  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${bundle.name}.json`);
  await writeFile(path, JSON.stringify(bundle, null, 2));

  console.log(`Wrote ${path}`);
  console.log(`  ${bundle.hotspots.length} detections, ${bundle.simulation.result.features.length} spread polygons, ${bundle.exposure.assets.length} assets`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
