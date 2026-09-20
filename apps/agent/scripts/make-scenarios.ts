/**
 * Build the synthetic scenario bundles.
 *
 * ARCA ships scenarios that need no credentials, so the system can be run and
 * judged by anyone who clones it. They are generated, and they say so in every
 * field that matters: the name, a `synthetic` flag, a blurb, and a note carried
 * into the incident. Nothing here is presented as recorded satellite data.
 *
 * The geography is real and so is the shape of the data — the pipeline cannot
 * tell the difference between these and a live fire, which is the whole point.
 * Three scenarios rather than one, because the interesting differences between
 * fires are not in the flames:
 *
 *   Bages     — rural, moderate wind, farms and a school. The base case.
 *   Empordà   — tramuntana, campsites in September. Lots of people, little time.
 *   Garraf    — wildland-urban interface. Hazardous industry beside housing.
 *
 * For a bundle recorded from the live DeepFire API, use `record-fixture.ts`.
 *
 *   pnpm --filter @arca/agent exec tsx scripts/make-scenarios.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "..", "..", "fixtures", "replay");

type Position = [number, number];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Metres to degrees at this latitude, so offsets are round on the ground. */
function offset(from: Position, eastM: number, northM: number): Position {
  const lat = from[1] + northM / 110_540;
  const lon = from[0] + eastM / (111_320 * Math.cos((from[1] * Math.PI) / 180));
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

/** Move `distanceM` along a compass bearing (degrees the fire is heading to). */
function along(from: Position, bearingDeg: number, distanceM: number, acrossM = 0): Position {
  const rad = (bearingDeg * Math.PI) / 180;
  const east = Math.sin(rad) * distanceM + Math.cos(rad) * acrossM;
  const north = Math.cos(rad) * distanceM - Math.sin(rad) * acrossM;
  return offset(from, east, north);
}

function ring(centre: Position, radiusM: number, stretch = 1, bearingDeg = 45, steps = 48): Position[] {
  const points: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    // Stretch along the wind axis rather than along east, so a fire driven
    // south looks driven south instead of driven east.
    points.push(along(centre, bearingDeg, Math.cos(theta) * radiusM * stretch, Math.sin(theta) * radiusM));
  }
  points.push(points[0]!);
  return points;
}

// ---------------------------------------------------------------------------
// Scenario descriptor
// ---------------------------------------------------------------------------

interface AssetSpec {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  /** Distance and cross-wind offset from ignition, in metres. */
  atM: [along: number, across: number];
  people: number;
  basis: string;
  bandMinutes: number;
  extras?: Record<string, unknown>;
}

interface Scenario {
  name: string;
  label: string;
  place: string;
  blurb: string;
  clusterId: string;
  ignition: Position;
  /** Compass bearing the fire is running towards. */
  bearingDeg: number;
  windSpeedMs: number;
  /** Head-fire rate of spread, metres per hour. */
  spreadMetresPerHour: number;
  startIso: string;
  locationName: string;
  populationResident: number;
  peakDensityPerKm2: number;
  /** A persistent industrial heat source the mask should catch. */
  staticSource: { name: string; type: string; atM: [number, number]; radiusM: number };
  assets: AssetSpec[];
  note: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: "demo-bages-synthetic",
    label: "Sant Fruitós de Bages",
    place: "Bages, Catalunya",
    blurb:
      "Rural fire north-east of Manresa in a moderate south-westerly. Farms, a school and a care home in the path; a quarry and a stray pixel in the feed to exercise the cleaning rules.",
    clusterId: "demo-cluster-bages",
    ignition: [1.876, 41.766],
    bearingDeg: 45,
    windSpeedMs: 8.4,
    spreadMetresPerHour: 1_150,
    startIso: "2026-09-19T11:40:00.000Z",
    locationName: "Sant Fruitós de Bages, Catalunya",
    populationResident: 4_820,
    peakDensityPerKm2: 1_900,
    staticSource: { name: "Pedrera de Sant Salvador (demo quarry)", type: "Thermal anomaly", atM: [-9_000, -4_500], radiusM: 320 },
    note:
      "Generated demo data, not recorded satellite output. Real geography near Sant Fruitós de Bages; detections, model run and exposure are constructed to exercise the cleaning, banding and ranking rules.",
    assets: [
      { id: "demo-care-1", name: "Residència Sant Andreu", category: "social_care", subcategory: "care_home", atM: [2_000, -100], people: 64, basis: "registered places", bandMinutes: 120 },
      { id: "demo-school-1", name: "Escola Monsenyor Gibert", category: "education", subcategory: "primary_school", atM: [3_300, -350], people: 312, basis: "enrolment", bandMinutes: 180 },
      {
        id: "demo-farm-1", name: "Mas del Grau", category: "livestock", subcategory: "livestock_farm",
        atM: [1_400, -140], people: 0, basis: "REGA capacity", bandMinutes: 120,
        extras: {
          capacity: { places: 340, people: 2, basis: "REGA capacity", confidence: 0.6, livestock_units: 340, species: [{ species: "sheep", count: 300 }, { species: "goat", count: 40 }] },
          criticality: 55, human_bearing: true,
        },
      },
      { id: "demo-camp-1", name: "Càmping El Solell", category: "tourism", subcategory: "campsite", atM: [4_100, 1_800], people: 180, basis: "pitches × 3", bandMinutes: 240 },
      { id: "demo-cap-1", name: "CAP Sant Fruitós", category: "healthcare", subcategory: "primary_care", atM: [7_200, 700], people: 40, basis: "registered", bandMinutes: 300, extras: { response_asset: true, criticality: 95 } },
      { id: "demo-school-2", name: "Institut Gallifa", category: "education", subcategory: "secondary_school", atM: [10_600, 1_500], people: 540, basis: "enrolment", bandMinutes: 360 },
      { id: "demo-care-2", name: "Residència El Roure", category: "social_care", subcategory: "care_home", atM: [14_000, 2_300], people: 48, basis: "registered places", bandMinutes: 360 },
      {
        id: "demo-fuel-1", name: "Estació de servei C-16", category: "industry", subcategory: "fuel_station",
        atM: [1_400, 150], people: 3, basis: "staff", bandMinutes: 60,
        extras: { hazardous: true, human_bearing: false, criticality: 60, vulnerability: 90 },
      },
      { id: "demo-nursery-1", name: "Llar d'infants Els Pinetons", category: "education", subcategory: "nursery", atM: [2_600, -220], people: 58, basis: "places", bandMinutes: 180, extras: { criticality: 95 } },
    ],
  },

  {
    name: "demo-emporda-synthetic",
    label: "Alt Empordà",
    place: "Alt Empordà, Catalunya",
    blurb:
      "Tramuntana fire above the Golf de Roses, driven hard to the south at 17 m/s. Two large campsites at September occupancy: the case where evacuation time, not distance, decides the order.",
    clusterId: "demo-cluster-emporda",
    ignition: [3.062, 42.298],
    bearingDeg: 180,
    windSpeedMs: 17.2,
    // 1.6 km/h head-fire rate. Fast for Catalonia and deliberately so, but the
    // earlier 2.6 gave a six-hour footprint over a thousand square kilometres,
    // which is not a fire, it is a county — and it put every asset in the
    // comarca inside the horizon with the same spare time.
    spreadMetresPerHour: 1_600,
    startIso: "2026-09-19T09:15:00.000Z",
    locationName: "Pau, Alt Empordà, Catalunya",
    populationResident: 11_400,
    peakDensityPerKm2: 3_400,
    staticSource: { name: "Planta d'asfalt de Vilajuïga (demo)", type: "Industrial heat", atM: [-6_800, 3_900], radiusM: 260 },
    note:
      "Generated demo data, not recorded satellite output. Real geography above the Golf de Roses; the tramuntana wind speed and the campsite occupancies are constructed to put several sites out of evacuation time at once.",
    assets: [
      {
        id: "demo-emp-camp-1", name: "Càmping La Tramuntana", category: "tourism", subcategory: "campsite",
        atM: [3_400, -600], people: 1_240, basis: "pitches × 3.4", bandMinutes: 60,
        extras: { criticality: 70, vulnerability: 95 },
      },
      {
        id: "demo-emp-camp-2", name: "Càmping Mar i Pins", category: "tourism", subcategory: "campsite",
        atM: [6_100, 1_500], people: 860, basis: "pitches × 3.4", bandMinutes: 120,
        extras: { criticality: 70, vulnerability: 95 },
      },
      { id: "demo-emp-hotel-1", name: "Hotel Cap de Creus", category: "tourism", subcategory: "hotel", atM: [4_800, -2_100], people: 210, basis: "rooms × 2.1", bandMinutes: 120 },
      { id: "demo-emp-school-1", name: "Escola de Pau", category: "education", subcategory: "primary_school", atM: [2_100, 900], people: 186, basis: "enrolment", bandMinutes: 60 },
      {
        id: "demo-emp-care-1", name: "Residència Empordà", category: "social_care", subcategory: "care_home",
        atM: [5_200, 400], people: 92, basis: "registered places", bandMinutes: 120,
        extras: { criticality: 95, vulnerability: 90 },
      },
      {
        id: "demo-emp-stable-1", name: "Hípica Serra de Rodes", category: "livestock", subcategory: "livestock_farm",
        atM: [1_900, -1_400], people: 4, basis: "staff", bandMinutes: 60,
        extras: {
          capacity: { places: 46, people: 4, basis: "REGA capacity", confidence: 0.6, livestock_units: 46, species: [{ species: "horse", count: 46 }] },
          criticality: 50, human_bearing: true,
        },
      },
      {
        id: "demo-emp-water-1", name: "ETAP de Roses", category: "utilities", subcategory: "water_treatment",
        atM: [8_900, -900], people: 6, basis: "staff", bandMinutes: 180,
        extras: { response_asset: true, criticality: 98, human_bearing: false },
      },
      {
        id: "demo-emp-sub-1", name: "Subestació Vilajuïga", category: "utilities", subcategory: "substation",
        atM: [2_800, 2_600], people: 0, basis: "unstaffed", bandMinutes: 60,
        extras: { hazardous: true, human_bearing: false, response_asset: true, criticality: 92, vulnerability: 70 },
      },
      { id: "demo-emp-marina-1", name: "Port de Roses", category: "tourism", subcategory: "marina", atM: [11_200, -1_800], people: 420, basis: "berths × 2", bandMinutes: 240 },
      { id: "demo-emp-school-2", name: "Institut Cap Norfeu", category: "education", subcategory: "secondary_school", atM: [12_600, 800], people: 610, basis: "enrolment", bandMinutes: 300 },
    ],
  },

  {
    name: "demo-garraf-synthetic",
    label: "Massís del Garraf",
    place: "Garraf, Catalunya",
    blurb:
      "Wildland-urban interface above Sitges in a sea breeze. Scattered urbanitzacions with one road out, a cement works and a hospital: the case where a hazardous site sits between the fire and the people.",
    clusterId: "demo-cluster-garraf",
    ignition: [1.836, 41.316],
    bearingDeg: 200,
    windSpeedMs: 6.1,
    spreadMetresPerHour: 780,
    startIso: "2026-09-19T13:05:00.000Z",
    locationName: "Olivella, Garraf, Catalunya",
    populationResident: 7_950,
    peakDensityPerKm2: 2_600,
    staticSource: { name: "Forn de calç de Garraf (demo kiln)", type: "Thermal anomaly", atM: [-5_400, 2_800], radiusM: 240 },
    note:
      "Generated demo data, not recorded satellite output. Real geography in the Garraf massif; the asset mix is constructed to put a hazardous industrial site and a hospital in the same path, which is where the action rules diverge.",
    assets: [
      {
        id: "demo-gar-urb-1", name: "Urbanització Can Lloses", category: "residential", subcategory: "dispersed_housing",
        atM: [1_800, 400], people: 640, basis: "dwellings × 2.6", bandMinutes: 120,
        extras: { criticality: 60, vulnerability: 88 },
      },
      {
        id: "demo-gar-urb-2", name: "Urbanització Mas Mestre", category: "residential", subcategory: "dispersed_housing",
        atM: [3_600, -1_200], people: 910, basis: "dwellings × 2.6", bandMinutes: 180,
        extras: { criticality: 60, vulnerability: 88 },
      },
      {
        id: "demo-gar-cement-1", name: "Cimentera de Vallcarca", category: "industry", subcategory: "chemical_plant",
        atM: [2_400, 1_600], people: 38, basis: "shift staff", bandMinutes: 120,
        extras: { hazardous: true, criticality: 75, vulnerability: 60 },
      },
      {
        id: "demo-gar-hosp-1", name: "Hospital Sant Camil", category: "healthcare", subcategory: "hospital",
        atM: [6_800, -600], people: 430, basis: "beds + staff", bandMinutes: 240,
        extras: { response_asset: true, criticality: 100, vulnerability: 85 },
      },
      { id: "demo-gar-school-1", name: "Escola Olivella", category: "education", subcategory: "primary_school", atM: [1_200, -700], people: 140, basis: "enrolment", bandMinutes: 60 },
      {
        id: "demo-gar-care-1", name: "Residència Garraf", category: "social_care", subcategory: "care_home",
        atM: [4_400, 900], people: 76, basis: "registered places", bandMinutes: 180,
        extras: { criticality: 95, vulnerability: 92 },
      },
      { id: "demo-gar-golf-1", name: "Club de Golf Terramar", category: "tourism", subcategory: "sports_ground", atM: [8_200, -2_400], people: 120, basis: "typical attendance", bandMinutes: 300 },
      {
        id: "demo-gar-mast-1", name: "Repetidor de la Morella", category: "utilities", subcategory: "telecom_mast",
        atM: [900, 1_900], people: 0, basis: "unstaffed", bandMinutes: 60,
        extras: { response_asset: true, criticality: 90, human_bearing: false },
      },
      { id: "demo-gar-camp-1", name: "Càmping El Garrofer", category: "tourism", subcategory: "campsite", atM: [9_600, -1_100], people: 340, basis: "pitches × 3", bandMinutes: 360 },
      {
        id: "demo-gar-fuel-1", name: "Estació de servei C-32", category: "industry", subcategory: "fuel_station",
        atM: [5_100, -1_800], people: 4, basis: "staff", bandMinutes: 240,
        extras: { hazardous: true, human_bearing: false, criticality: 60, vulnerability: 90 },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Detections
// ---------------------------------------------------------------------------

/**
 * Detections, growing with the fire.
 *
 * Satellites do not see tidy diagonals. A polar pass over an active fire
 * returns a band of pixels along the burning perimeter — dense and hot at the
 * head, thinner along the flanks, nothing in the interior where the fuel has
 * already gone — plus the occasional spot fire thrown downwind. An earlier
 * version emitted points on a straight line, which on a map looked like
 * scattered noise rather than a fire.
 *
 * So this draws an actual front: an arc centred on the ignition, growing with
 * each pass, sampled more densely and more energetically towards the head.
 *
 * It also deliberately includes three things a clean feed would not: a
 * persistent industrial source two satellites keep reporting, a lone
 * low-confidence pixel, and a geostationary re-report of the same coarse pixel.
 * Those are what the cleaning rules exist for, and a scenario that omits them
 * would not show the product working.
 */
function hotspots(scenario: Scenario) {
  const rows: Array<Record<string, unknown>> = [];
  const start = Date.parse(scenario.startIso);
  const push = (
    minutes: number,
    position: Position,
    source: string,
    confidence: string,
    frp: number,
    clusterId = scenario.clusterId,
  ) => {
    rows.push({
      id: `${scenario.clusterId}-h${rows.length.toString().padStart(3, "0")}`,
      clusterId,
      position,
      observedAt: new Date(start + minutes * 60_000).toISOString(),
      source,
      confidence,
      fireRadiativePowerMw: Number(frp.toFixed(1)),
      country: "ES",
      active: true,
    });
  };

  // Deterministic jitter. Real detections are pixel centres on a satellite
  // grid, not points on a curve, so a little scatter is truthful — but a
  // generated fixture that changes every time it is built is not.
  let seed = 1;
  const noise = (spread: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return ((seed / 2_147_483_648) * 2 - 1) * spread;
  };

  /**
   * One satellite pass over the burning perimeter.
   *
   * `radius` is how far the head has run. The arc spans roughly ±70° either
   * side of the wind axis: beyond that the flanks are barely burning and the
   * back of the fire is out.
   */
  const pass = (
    minutes: number,
    radius: number,
    source: string,
    options: { pixels: number; headFrp: number; grade?: (t: number) => string; jitter?: number },
  ) => {
    const jitter = options.jitter ?? radius * 0.08;
    for (let i = 0; i < options.pixels; i++) {
      // t: 0 at one flank, 1 at the other, 0.5 at the head.
      const t = options.pixels === 1 ? 0.5 : i / (options.pixels - 1);
      const angle = (t - 0.5) * 2 * 70;
      const headness = Math.cos((angle * Math.PI) / 180);

      // Flanks lag the head: an elliptical front, not a circle.
      const reach = radius * (0.42 + 0.58 * headness);
      const along = Math.cos((angle * Math.PI) / 180) * reach + noise(jitter);
      const across = Math.sin((angle * Math.PI) / 180) * reach + noise(jitter);

      const frp = options.headFrp * (0.25 + 0.75 * headness ** 2);
      const grade = options.grade?.(headness) ?? (headness > 0.55 ? "HIGH" : "MEDIUM");
      push(minutes, along2(scenario, along, across), source, grade, Math.max(4, frp));
    }
  };

  const rate = scenario.spreadMetresPerHour;

  // First pass: one polar satellite catches a young front.
  pass(0, rate * 0.35, "VIIRS_NOAA20_NRT", { pixels: 7, headFrp: 55 });

  // Geostationary confirms twenty minutes later, coarser and less certain.
  pass(22, rate * 0.5, "MTG_I1", {
    pixels: 4,
    headFrp: 70,
    grade: () => "MEDIUM",
    jitter: rate * 0.09,
  });

  // A re-report of the same coarse pixel. The duplicate rule should collapse it.
  const repeat = rows.at(-1) as { position: Position } | undefined;
  if (repeat) push(24, [repeat.position[0] + 0.0004, repeat.position[1] + 0.0003], "MTG_I1", "MEDIUM", 58);

  // Second pass: the front has run downwind and intensified.
  pass(54, rate * 0.95, "VIIRS_SNPP_NRT", { pixels: 13, headFrp: 185 });

  // Landsat catches the head at 30 m: a tight, hot cluster right at the nose.
  for (let i = 0; i < 4; i++) {
    const across = (i - 1.5) * 220;
    push(61, along2(scenario, rate * 1.02, across), "LANDSAT_NRT", "HIGH", 210 + i * 26);
  }

  // Two spot fires thrown ahead of the head by the wind. Real, and the reason
  // a perimeter is not the same thing as a threat boundary.
  push(58, along2(scenario, rate * 1.45, -560), "VIIRS_SNPP_NRT", "MEDIUM", 38);
  push(61, along2(scenario, rate * 1.6, 380), "VIIRS_NOAA20_NRT", "MEDIUM", 31);

  // The persistent industrial source, reported by two satellites all day. Two
  // sensors agreeing about a kiln is still a kiln.
  const staticAt = offset(scenario.ignition, scenario.staticSource.atM[0], scenario.staticSource.atM[1]);
  push(8, staticAt, "MODIS_NRT", "MEDIUM", 21);
  push(46, offset(staticAt, 25, 22), "VIIRS_SNPP_NRT", "MEDIUM", 24);

  // A single low-confidence pixel well away, in its own cluster. With nothing
  // to corroborate it, the confidence rule should exclude it — which is the
  // difference between an early-warning system and a false-alarm generator.
  push(37, along2(scenario, -4_800, 5_200), "MODIS_NRT", "LOW", 9, `${scenario.clusterId}-stray`);

  return rows;
}

/** Shorthand: a point `along` the wind axis and `across` it, from ignition. */
function along2(scenario: Scenario, alongM: number, acrossM: number): Position {
  return along(scenario.ignition, scenario.bearingDeg, alongM, acrossM);
}

// ---------------------------------------------------------------------------
// Model run
// ---------------------------------------------------------------------------

/**
 * A ten-member ensemble in DeepFire's shape: per hour, nested probability
 * contours, stretched along the wind. Higher probability means a tighter
 * footprint, which is what an ensemble actually produces.
 */
function simulation(scenario: Scenario) {
  const features: Array<Record<string, unknown>> = [];
  const contours: Array<[number, number]> = [
    [0.9, 0.42],
    [0.7, 0.58],
    [0.5, 0.74],
    [0.3, 0.9],
    [0.2, 1.0],
  ];

  let burnedAreaM2 = 0;
  for (let hour = 1; hour <= 6; hour++) {
    const reach = scenario.spreadMetresPerHour * hour;
    // The footprint centre travels downwind while the back of the fire stays
    // near the ignition, so the ellipse is offset rather than concentric.
    const centre = along(scenario.ignition, scenario.bearingDeg, reach * 0.62);
    for (const [probability, scale] of contours) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [ring(centre, reach * scale, 1.35, scenario.bearingDeg)],
        },
        properties: { hour, elapsed_seconds: hour * 3600, burn_probability: probability },
      });
    }
    if (hour === 6) burnedAreaM2 = Math.round(Math.PI * reach * reach * 1.35 * 0.55);
  }

  return {
    id: `${scenario.clusterId}-sim`,
    status: "COMPLETED",
    clusterId: scenario.clusterId,
    model: "elmfire",
    durationHours: 6,
    ensembleMembers: 10,
    sources: ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "LANDSAT_NRT"],
    lookbackHours: 12,
    locationName: scenario.locationName,
    ignitionPointCount: 24,
    ignition: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: scenario.ignition }, properties: {} },
      ],
    },
    summary: {
      burnedAreaM2,
      edgeReached: false,
      windSpeedAvgMs: scenario.windSpeedMs,
      // Meteorological convention: the direction the wind blows *from*.
      windDirectionAvg: (scenario.bearingDeg + 180) % 360,
    },
    result: { type: "FeatureCollection", features },
  };
}

// ---------------------------------------------------------------------------
// Exposure
// ---------------------------------------------------------------------------

/**
 * A stand-in exposure report.
 *
 * Only used when Talaia is unreachable — it is the last rung of the failsafe
 * ladder. With a TALAIA_API_KEY set, the scenario queries the live service like
 * any other incident, which is the path worth demonstrating.
 */
function exposure(scenario: Scenario) {
  const assets = scenario.assets.map((spec) => {
    const position = along(scenario.ignition, scenario.bearingDeg, spec.atM[0], spec.atM[1]);
    return {
      id: spec.id,
      category: spec.category,
      subcategory: spec.subcategory,
      name: spec.name,
      geometry: { type: "Point", coordinates: position },
      capacity: { places: spec.people, people: spec.people, basis: spec.basis, confidence: 0.7 },
      contacts: { phone: ["+34938000000"], email: [], operator: null },
      valuation: {
        total_eur: spec.people * 45_000 + 400_000,
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
        band: `t+${Math.round(spec.bandMinutes / 60)}h`,
        band_minutes: spec.bandMinutes,
        inside_aoi: true,
        priority_score: 60,
      },
      provenance: [{ source_id: "demo.synthetic", source_ref: spec.id }],
      ...(spec.extras ?? {}),
    } as Record<string, unknown> & {
      capacity: { people?: number; livestock_units?: number };
      valuation: { total_eur: number };
      criticality?: number;
      hazardous?: boolean;
    };
  });

  const livestock = assets.reduce((sum, asset) => sum + (asset.capacity.livestock_units ?? 0), 0);

  return {
    summary: {
      asset_count: assets.length,
      people_estimate: assets.reduce((sum, asset) => sum + (asset.capacity.people ?? 0), 0),
      population_resident: scenario.populationResident,
      total_value_eur: assets.reduce((sum, asset) => sum + asset.valuation.total_eur, 0),
      critical_assets: assets.filter((asset) => (asset.criticality ?? 0) >= 90).length,
      hazardous_assets: assets.filter((asset) => asset.hazardous).length,
      livestock_units: livestock,
      coverage_regime: "synthetic demo bundle — not Talaia output",
    },
    bands: [],
    assets,
    warnings: [
      "This exposure is a synthetic demo fixture, not a Talaia response. Set TALAIA_API_KEY to query real registries.",
    ],
    population: {
      total: scenario.populationResident,
      cell_count: 6,
      peak_density_per_km2: scenario.peakDensityPerKm2,
      cells: [],
    },
  };
}

// ---------------------------------------------------------------------------

function build(scenario: Scenario) {
  const start = Date.parse(scenario.startIso);
  return {
    name: scenario.name,
    label: scenario.label,
    place: scenario.place,
    blurb: scenario.blurb,
    synthetic: true,
    note: `${scenario.note} Use scripts/record-fixture.ts to capture a real fire from the DeepFire API.`,
    clusterId: scenario.clusterId,
    position: scenario.ignition,
    firstObserved: new Date(start).toISOString(),
    lastObserved: new Date(start + 65 * 60_000).toISOString(),
    hasPerimeter: true,
    staticSources: [
      {
        id: `${scenario.clusterId}-static`,
        type: scenario.staticSource.type,
        remarks: scenario.staticSource.name,
        geometry: {
          type: "Polygon",
          coordinates: [
            ring(
              offset(scenario.ignition, scenario.staticSource.atM[0], scenario.staticSource.atM[1]),
              scenario.staticSource.radiusM,
            ),
          ],
        },
      },
    ],
    hotspots: hotspots(scenario),
    simulation: simulation(scenario),
    exposure: exposure(scenario),
  };
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  for (const scenario of SCENARIOS) {
    const bundle = build(scenario);
    const path = join(outDir, `${bundle.name}.json`);
    await writeFile(path, JSON.stringify(bundle, null, 2));
    console.log(`Wrote ${path}`);
    console.log(
      `  ${bundle.hotspots.length} detections, ${bundle.simulation.result.features.length} spread polygons, ${bundle.exposure.assets.length} assets, ${bundle.exposure.summary.people_estimate} people`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
